require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { Op }  = require('sequelize');
const sequelize = require('./db');
const { Game, Price, PriceHistory } = require('./models');
const parseSteam = require('./services/steamParser');
const parseEpic  = require('./services/epicParser');
const parseGog   = require('./services/gogParser');
const {
    startMetricsServer,
    apiErrorsCounter,
} = require('./metrics');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ message: 'Сервер агрегатора успешно работает!' });
});

// Список игр со всеми ценами по платформам
app.get('/api/games', async (req, res) => {
    try {
        const games = await Game.findAll({ include: [Price] });
        res.json(games);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Сводная статистика для дашборда
app.get('/api/stats', async (req, res) => {
    try {
        const totalGames  = await Game.count();
        const totalPrices = await Price.count();
        const onSale      = await Price.count({ where: { discount_percent: { [Op.gt]: 0 } } });
        const platforms   = await Price.findAll({
            attributes: ['platform', [sequelize.fn('COUNT', sequelize.col('platform')), 'count']],
            group: ['platform']
        });
        res.json({
            totalGames,
            totalPrices,
            onSale,
            platforms: platforms.map(p => ({ platform: p.platform, count: Number(p.get('count')) }))
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Игры, представленные более чем на одной платформе (суть агрегатора)
app.get('/api/games/multiplatform', async (req, res) => {
    try {
        const games = await Game.findAll({ include: [{ model: Price, required: true }] });
        const result = games
            .filter(g => g.prices.length >= 2)
            .map(g => {
                const platforms = g.prices.map(p => ({
                    platform: p.platform,
                    price:    Number(p.price),
                    url:      p.url
                }));
                const cheapest = platforms.reduce((a, b) => (b.price < a.price ? b : a));
                return { id: g.id, title: g.title, genre: g.genre, platforms, cheapest };
            });
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Топ скидок
app.get('/api/deals', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const deals = await Price.findAll({
            where: { discount_percent: { [Op.gt]: 0 } },
            order: [['discount_percent', 'DESC']],
            limit,
            include: [{ model: Game, attributes: ['title', 'genre'] }]
        });
        res.json(deals);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// История цен по конкретной игре
app.get('/api/games/:id/history', async (req, res) => {
    try {
        const history = await PriceHistory.findAll({
            where: { game_id: req.params.id },
            order: [['date', 'ASC']]
        });
        res.json(history);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Запуск парсеров вынесен в отдельную функцию: не блокирует старт API.
// Управляется переменной окружения RUN_PARSERS (по умолчанию выключено),
// поэтому сервер для демонстрации поднимается мгновенно.
async function runParsers() {
    try {
        await parseSteam();
        await parseEpic();
        await parseGog();
    } catch (e) {
        console.error('Ошибка при парсинге:', e);
        apiErrorsCounter.inc({ platform: 'unknown' });
    }
}

const start = async () => {
    try {
        startMetricsServer(9090);

        await sequelize.authenticate();
        console.log('Подключение к БД установлено.');

        await sequelize.sync({ alter: true });
        console.log('Таблицы созданы и связаны');

        const PORT = process.env.PORT || 5000;
        app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));

        if (process.env.RUN_PARSERS === 'true') {
            console.log('RUN_PARSERS=true — запускаю парсеры в фоне...');
            runParsers();
        } else {
            console.log('Парсеры выключены (RUN_PARSERS!=true). API уже доступно.');
        }
    } catch (e) {
        console.error('Критическая ошибка при запуске сервера:', e);
        apiErrorsCounter.inc({ platform: 'unknown' });
    }
};

start();
