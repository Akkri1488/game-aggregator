require('dotenv').config({ path: '../.env' });
const sequelize = require('../db');
const axios     = require('axios');
const { Game, Price, PriceHistory } = require('../models');
const { findOrCreateGame } = require('../services/gameMatcher');
const {
    gamesParsedCounter,
    apiErrorsCounter,
    gamesSkippedCounter,
    batchDurationHistogram,
    queueSizeGauge,
    parserRunningGauge,
} = require('../metrics');

const PLATFORM = 'Steam';
const sleep    = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- Источник 1: Featured categories ---
async function fetchFeaturedIds() {
    const ids = new Set();
    try {
        const res  = await axios.get('https://store.steampowered.com/api/featuredcategories/?cc=ru');
        const data = res.data;
        const cats = ['top_sellers', 'new_releases', 'specials', 'coming_soon', 'top_wishlisted'];
        for (const cat of cats) {
            data[cat]?.items?.forEach(item => { if (item.id) ids.add(item.id); });
        }
        console.log(`[Featured] ${ids.size} IDs`);
    } catch (e) {
        console.warn('[Featured]', e.message);
    }
    return ids;
}

// --- Источник 2: SteamSpy — весь каталог постранично ---
async function fetchSteamSpyAll(maxPages = 3) {
    const ids = new Set();
    let page  = 0;

    console.log(`[SteamSpy] Начинаем загрузку каталога (лимит: ${maxPages === Infinity ? 'Все' : maxPages} страниц)...`);

    while (page < maxPages) {
        try {
            await sleep(1500);
            const res  = await axios.get(`https://steamspy.com/api.php?request=all&page=${page}`);
            const data = res.data;

            if (!data || Object.keys(data).length === 0) {
                console.log(`[SteamSpy] Страница ${page} пустая — завершаем`);
                break;
            }

            Object.keys(data).forEach(id => ids.add(Number(id)));
            console.log(`[SteamSpy] Страница ${page}: итого ${ids.size} IDs`);
            page++;
        } catch (e) {
            console.warn(`[SteamSpy] Страница ${page}:`, e.message);
            await sleep(3000);
            break;
        }
    }

    console.log(`[SteamSpy] Финал: ${ids.size} IDs`);
    return Array.from(ids);
}

// --- Получить детали по appid ---
async function fetchAppDetails(appId) {
    try {
        const res = await axios.get(
            `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=ru&l=russian`,
            { timeout: 8000 }
        );
        const entry = res.data?.[appId];
        if (!entry?.success) return null;
        return entry.data ?? null;
    } catch {
        return null;
    }
}

// --- Сохранить игру ---
async function saveGame(appId, data) {
    try {
        if (data.type !== 'game') {
            gamesSkippedCounter.inc({ platform: PLATFORM });
            return null;
        }

        const developer = data.developers?.[0] ?? 'Unknown';
        const genre     = data.genres?.map(g => g.description).join(', ') ?? null;
        const url       = `https://store.steampowered.com/app/${appId}`;

        const game = await findOrCreateGame(data.name, developer, genre);
        if (!game) {
            gamesSkippedCounter.inc({ platform: PLATFORM });
            return null;
        }

        const isFree        = data.is_free ?? false;
        const priceOverview = data.price_overview;
        const finalPrice    = isFree ? 0 : (priceOverview?.final   ?? 0) / 100;
        const origPrice     = isFree ? 0 : (priceOverview?.initial ?? priceOverview?.final ?? 0) / 100;
        const discount      = priceOverview?.discount_percent ?? 0;

        await Price.upsert({
            game_id:          game.id,
            price:            finalPrice,
            original_price:   origPrice,
            discount_percent: discount,
            platform:         PLATFORM,
            external_id:      `steam_${appId}`,
            url
        });

        await PriceHistory.create({ game_id: game.id, price: finalPrice });

        gamesParsedCounter.inc({ platform: PLATFORM });

        return game;
    } catch (e) {
        console.warn(`[DB] appId ${appId}:`, e.message);
        apiErrorsCounter.inc({ platform: PLATFORM });
        return null;
    }
}

// --- Главная функция ---
async function parseSteam() {
    console.log('\n========================================');
    console.log('   ПОЛНЫЙ ПАРСИНГ STEAM');
    console.log('========================================\n');

    parserRunningGauge.set({ platform: PLATFORM }, 1);

    try {
        // 1. Собираем ID
        const [featuredIds, spyIds] = await Promise.all([
            fetchFeaturedIds(),
            fetchSteamSpyAll(2),
        ]);

        const safeFeatured = featuredIds ? Array.from(featuredIds) : [];
        const safeSpy      = spyIds || [];

        // 2. Объединяем, приоритетные — в начало
        const priorityIds = new Set(safeFeatured);
        const allIds      = new Set([...safeFeatured, ...safeSpy]);

        let queue = [
            ...Array.from(allIds).filter(id =>  priorityIds.has(id)),
            ...Array.from(allIds).filter(id => !priorityIds.has(id)),
        ];

        // ─── ТЕСТОВЫЙ ЛИМИТ НА ЗАПИСЬ (РУБИЛЬНИК) ───
        const TEST_LIMIT = 300;
        if (TEST_LIMIT > 0) {
            queue = queue.slice(0, TEST_LIMIT);
            console.log(`\n️ тестовый лимит: очередь записи урезана до ${TEST_LIMIT} игр`);
        }

        console.log(`\nВсего игр в очереди на обработку: ${queue.length}`);
        console.log(`Ожидаемое время: ~${Math.round(queue.length / 250)} мин\n`);

        // 3. Обработка батчами
        const BATCH_SIZE  = 5;
        const BATCH_DELAY = 1200;
        let saved = 0, skipped = 0, errors = 0;
        const startTime = Date.now();

        for (let i = 0; i < queue.length; i += BATCH_SIZE) {
            queueSizeGauge.set({ platform: PLATFORM }, queue.length - i);

            const batchStart = Date.now();
            const batch      = queue.slice(i, i + BATCH_SIZE);
            const details    = await Promise.all(batch.map(id => fetchAppDetails(id)));

            for (let j = 0; j < batch.length; j++) {
                if (!details[j]) { errors++; continue; }
                const result = await saveGame(batch[j], details[j]);
                result ? saved++ : skipped++;
            }

            batchDurationHistogram.observe(
                { platform: PLATFORM },
                (Date.now() - batchStart) / 1000
            );

            if (i % 100 === 0 && i > 0) {
                console.log(`[${i}/${queue.length}] Сохранено: ${saved} | Пропущено: ${skipped} | Ошибки API: ${errors}`);
            }

            await sleep(BATCH_DELAY);
        }

        queueSizeGauge.set({ platform: PLATFORM }, 0);

        const totalMin = Math.round((Date.now() - startTime) / 1000 / 60) || 1;
        console.log('\n========================================');
        console.log(`  ПАРСИНГ ЗАВЕРШЁН за ${totalMin} мин`);
        console.log(`  Игр сохранено:  ${saved}`);
        console.log(`  Ошибки API:     ${errors}`);
        console.log('========================================\n');

    } finally {
        parserRunningGauge.set({ platform: PLATFORM }, 0);
    }
}

module.exports = parseSteam;