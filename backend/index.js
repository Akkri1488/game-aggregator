require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const sequelize = require('./db');
const { Game, Price } = require('./models');
const parseSteam = require('./services/steamParser');
const parseEpic  = require('./services/epicParser');
const parseGog   = require('./services/gogParser');
const {
    startMetricsServer,
    gamesParsedCounter,
    apiErrorsCounter,
} = require('./metrics');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ message: 'Сервер агрегатора успешно работает!' });
});

app.get('/api/games', async (req, res) => {
    try {
        const games = await Game.findAll({ include: [Price] });
        res.json(games);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const start = async () => {
    try {
        // Сервер метрик поднимаем первым — до парсеров
        startMetricsServer(9090);

        await sequelize.authenticate();
        console.log('Подключение к БД установлено.');

        await sequelize.sync({ alter: true });
        console.log('Таблицы созданы и связаны');

        await parseSteam();
        await parseEpic();
        await parseGog();

        const PORT = process.env.PORT || 5000;
        app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
    } catch (e) {
        console.error('Критическая ошибка при запуске сервера:', e);
        apiErrorsCounter.inc({ platform: 'unknown' });
    }
};

start();