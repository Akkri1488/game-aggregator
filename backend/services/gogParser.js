const axios = require('axios');
const { Price, PriceHistory } = require('../models');
const { findOrCreateGame } = require('./gameMatcher');
const {
    gamesParsedCounter,
    apiErrorsCounter,
    gamesSkippedCounter,
    batchDurationHistogram,
    queueSizeGauge,
    parserRunningGauge,
} = require('../metrics');

const PLATFORM    = 'GOG';
const GOG_CATALOG = 'https://catalog.gog.com/v1/catalog';
const GOG_DETAILS = 'https://api.gog.com/products';
const sleep       = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchGogPage(page) {
    const res = await axios.get(GOG_CATALOG, {
        params: {
            productType:  'in:game',
            limit:        48,
            page,
            order:        'desc:releaseDate',
            countryCode:  'RU',
            locale:       'ru-RU',
            currencyCode: 'RUB'
        }
    });
    return res.data;
}

async function fetchGogDetails(gogId) {
    try {
        const res = await axios.get(`${GOG_DETAILS}/${gogId}`, {
            params:  { locale: 'ru-RU', expand: 'description' },
            timeout: 8000
        });
        return res.data;
    } catch {
        return null;
    }
}

async function saveGogGame(item, details) {
    try {
        const price = item.price;
        if (!price) {
            gamesSkippedCounter.inc({ platform: PLATFORM });
            return null;
        }

        const finalPrice    = parseFloat(price.finalMoney?.amount ?? 0);
        const originalPrice = parseFloat(price.baseMoney?.amount  ?? finalPrice);
        const discount      = price.discountedPercent ?? 0;

        const genre     = details?.genres?.map(g => g.name?.['*'] || g.name).filter(Boolean).join(', ') || null;
        const developer = details?.company ?? item.developers?.[0] ?? 'Unknown';
        const gogId     = String(item.id);
        const slug      = item.slug || gogId;
        const url       = `https://www.gog.com/game/${slug}`;

        const game = await findOrCreateGame(item.title, developer, genre);
        if (!game) {
            gamesSkippedCounter.inc({ platform: PLATFORM });
            return null;
        }

        await Price.upsert({
            game_id:          game.id,
            price:            finalPrice,
            original_price:   originalPrice,
            discount_percent: discount,
            platform:         PLATFORM,
            external_id:      `gog_${gogId}`,
            url
        });

        await PriceHistory.create({ game_id: game.id, price: finalPrice });

        gamesParsedCounter.inc({ platform: PLATFORM });

        return game;
    } catch (e) {
        console.warn(`[GOG DB] "${item.title}":`, e.message);
        apiErrorsCounter.inc({ platform: PLATFORM });
        return null;
    }
}

async function parseGog() {
    console.log('=== Запуск парсера GOG ===');

    parserRunningGauge.set({ platform: PLATFORM }, 1);

    let page = 1, totalPages = null;
    let saved = 0, skipped = 0;

    try {
        do {
            try {
                await sleep(700);
                const data = await fetchGogPage(page);

                if (totalPages === null) {
                    totalPages = data.pages ?? 1;
                    console.log(`[GOG] Страниц: ${totalPages} (~${totalPages * 48} игр)`);
                }

                const items = data.products ?? [];
                const BATCH = 5;

                queueSizeGauge.set({ platform: PLATFORM }, (totalPages - page) * 48);

                for (let i = 0; i < items.length; i += BATCH) {
                    const batchStart   = Date.now();
                    const batch        = items.slice(i, i + BATCH);
                    const detailsBatch = await Promise.all(batch.map(item => fetchGogDetails(item.id)));

                    for (let j = 0; j < batch.length; j++) {
                        const res = await saveGogGame(batch[j], detailsBatch[j]);
                        res ? saved++ : skipped++;
                    }

                    batchDurationHistogram.observe(
                        { platform: PLATFORM },
                        (Date.now() - batchStart) / 1000
                    );

                    await sleep(500);
                }

                console.log(`[GOG] Страница ${page}/${totalPages} | Сохранено: ${saved}`);
                page++;

            } catch (e) {
                console.error(`[GOG] Ошибка страница ${page}:`, e.message);
                apiErrorsCounter.inc({ platform: PLATFORM });
                break;
            }

        } while (page <= Math.min(totalPages ?? 1, 5));

        queueSizeGauge.set({ platform: PLATFORM }, 0);
        console.log(`=== GOG завершён. Сохранено: ${saved} | Пропущено: ${skipped} ===\n`);

    } finally {
        parserRunningGauge.set({ platform: PLATFORM }, 0);
    }
}

module.exports = parseGog;