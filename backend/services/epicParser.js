const axios = require('axios');
const { findOrCreateGame } = require('./gameMatcher');
const { savePrice } = require('./priceWriter');
const {
    gamesParsedCounter,
    apiErrorsCounter,
    gamesSkippedCounter,
    batchDurationHistogram,
    queueSizeGauge,
    parserRunningGauge,
} = require('../metrics');

const PLATFORM    = 'Epic';
const EPIC_PROMO  = 'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions';
const EPIC_BROWSE = 'https://store.epicgames.com/graphql';
const sleep       = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchFreeAndPromo() {
    const res = await axios.get(EPIC_PROMO, {
        params: { locale: 'ru', country: 'RU', allowCountries: 'RU' }
    });
    return res.data?.data?.Catalog?.searchStore?.elements ?? [];
}

async function fetchCatalogPage(start) {
    const query = {
        query: `query searchStoreQuery(
            $allowCountries: String, $category: String,
            $count: Int, $country: String!, $locale: String,
            $sortBy: String, $sortDir: String, $start: Int
        ) {
            Catalog {
                searchStore(
                    allowCountries: $allowCountries
                    category: $category
                    count: $count
                    country: $country
                    locale: $locale
                    sortBy: $sortBy
                    sortDir: $sortDir
                    start: $start
                ) {
                    elements {
                        title
                        id
                        namespace
                        productSlug
                        urlSlug
                        seller { name }
                        price(country: $country) {
                            totalPrice {
                                discountPrice
                                originalPrice
                                discount
                            }
                        }
                        categories { path }
                        tags { name }
                    }
                    paging { total count }
                }
            }
        }`,
        variables: {
            allowCountries: 'RU',
            category:       'games/edition/base',
            count:          40,
            country:        'RU',
            locale:         'ru',
            sortBy:         'releaseDate',
            sortDir:        'DESC',
            start
        }
    };

    const res = await axios.post(EPIC_BROWSE, query, {
        headers: {
            'Content-Type': 'application/json',
            'User-Agent':   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        },
        timeout: 10000
    });
    return res.data?.data?.Catalog?.searchStore;
}

// Собирает рабочую ссылку на страницу игры в Epic.
// namespace — это внутренний ID, а не адрес страницы, поэтому используем slug.
// productSlug/urlSlug — часть стандартного ответа searchStore.
// Если slug нет или он пустой — ведём на поиск по названию (рабочая ссылка вместо not-found).
function buildEpicUrl(item) {
    let slug = item.productSlug || item.urlSlug || null;

    if (slug && slug !== 'null' && slug !== '[]') {
        slug = slug.replace(/\/home$/, '');
        return `https://store.epicgames.com/ru/p/${slug}`;
    }
    return `https://store.epicgames.com/ru/browse?q=${encodeURIComponent(item.title)}`;
}

async function saveEpicGame(item) {
    try {
        const priceData = item.price?.totalPrice;
        if (!priceData) {
            gamesSkippedCounter.inc({ platform: PLATFORM });
            return null;
        }

        const categories = item.categories?.map(c => c.path) ?? [];
        const isGame     = categories.some(c => c.includes('games') && !c.includes('addon') && !c.includes('dlc'));
        if (!isGame && categories.length > 0) {
            gamesSkippedCounter.inc({ platform: PLATFORM });
            return null;
        }

        const finalPrice    = (priceData.discountPrice ?? 0) / 100;
        const originalPrice = (priceData.originalPrice ?? 0) / 100;
        const discount      = originalPrice > 0 && originalPrice !== finalPrice
            ? Math.round((1 - finalPrice / originalPrice) * 100)
            : 0;

        const genre     = item.tags?.filter(t => t?.name).map(t => t.name).slice(0, 3).join(', ') || null;
        const developer = item.seller?.name ?? 'Unknown';
        const url       = buildEpicUrl(item);

        const game = await findOrCreateGame(item.title, developer, genre);
        if (!game) {
            gamesSkippedCounter.inc({ platform: PLATFORM });
            return null;
        }

        await savePrice({
            gameId:        game.id,
            price:         finalPrice,
            originalPrice: originalPrice,
            discount,
            platform:      PLATFORM,
            externalId:    `epic_${item.id}`,
            url
        });

        gamesParsedCounter.inc({ platform: PLATFORM });

        return game;
    } catch (e) {
        console.warn(`[Epic DB] "${item.title}":`, e.message);
        apiErrorsCounter.inc({ platform: PLATFORM });
        return null;
    }
}

async function parseEpic() {
    console.log('=== Запуск парсера Epic Games Store ===');

    parserRunningGauge.set({ platform: PLATFORM }, 1);

    let saved = 0, skipped = 0;

    try {
        // Источник 1: промо/бесплатные
        try {
            const promoItems = await fetchFreeAndPromo();
            console.log(`[Epic] Promo endpoint: ${promoItems.length} игр`);

            const batchStart = Date.now();
            for (const item of promoItems) {
                const res = await saveEpicGame(item);
                res ? saved++ : skipped++;
            }
            batchDurationHistogram.observe(
                { platform: PLATFORM },
                (Date.now() - batchStart) / 1000
            );
        } catch (e) {
            console.warn('[Epic] Promo endpoint недоступен:', e.message);
            apiErrorsCounter.inc({ platform: PLATFORM });
        }

        // Источник 2: каталог постранично
        let start = 0;
        const PAGE_SIZE = 40;
        let total = null;

        do {
            try {
                await sleep(900);
                const result = await fetchCatalogPage(start);
                if (!result) break;

                if (total === null) {
                    total = result.paging?.total ?? 0;
                    console.log(`[Epic] Всего в каталоге: ${total}`);
                }

                queueSizeGauge.set({ platform: PLATFORM }, Math.max(0, total - start));

                const batchStart = Date.now();
                for (const item of result.elements) {
                    if (!item.title || !item.id) {
                        skipped++;
                        gamesSkippedCounter.inc({ platform: PLATFORM });
                        continue;
                    }
                    const res = await saveEpicGame(item);
                    res ? saved++ : skipped++;
                }
                batchDurationHistogram.observe(
                    { platform: PLATFORM },
                    (Date.now() - batchStart) / 1000
                );

                console.log(`[Epic] ${start + result.elements.length}/${total} | Сохранено: ${saved}`);
                start += PAGE_SIZE;

            } catch (e) {
                console.error(`[Epic] Ошибка start=${start}:`, e.message);
                apiErrorsCounter.inc({ platform: PLATFORM });
                start += PAGE_SIZE;
                await sleep(2000);
            }

        } while (start < Math.min(total ?? 0, 500));

        queueSizeGauge.set({ platform: PLATFORM }, 0);
        console.log(`=== Epic завершён. Сохранено: ${saved} | Пропущено: ${skipped} ===\n`);

    } finally {
        parserRunningGauge.set({ platform: PLATFORM }, 0);
    }
}

module.exports = parseEpic;