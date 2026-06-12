require('dotenv').config();
const sequelize = require('./db');
const { Game, Price, PriceHistory } = require('./models');

(async () => {
    try {
        await sequelize.authenticate();
        console.log('Подключение к БД установлено.');
        // force: true удаляет таблицы и создаёт заново с актуальными индексами
        await sequelize.sync({ force: true });
        console.log('Таблицы пересозданы с нуля. Дубликаты удалены.');
        process.exit(0);
    } catch (e) {
        console.error('Ошибка сброса БД:', e.message);
        process.exit(1);
    }
})();