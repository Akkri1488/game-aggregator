require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const sequelize = require('./db');
const { Game, Price, PriceHistory } = require('../../../../Downloads/game-aggregator-main-2/backend/models');
const parseSteam = require('./services/steamParser');
const parseEpic  = require('./services/epicParser');
const parseGog   = require('./services/gogParser');
const {
    startMetricsServer,
    apiErrorsCounter,
} = require('../../../../Downloads/game-aggregator-main-2/backend/metrics');

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
        // Сервер метрик поднимаем первым
        startMetricsServer(9090);

        await sequelize.authenticate();
        console.log('Подключение к БД установлено.');

        await sequelize.sync({ alter: true });
        console.log('Таблицы созданы и связаны');

        const PORT = process.env.PORT || 5000;
        app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));

        // Парсеры запускаем в фоне, только если явно включено
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
