const { DataTypes } = require('sequelize');
const sequelize = require('./db');

// Единая таблица игр (общие данные)
const Game = sequelize.define('game', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    title: { type: DataTypes.STRING, allowNull: false, unique: true },
    developer: { type: DataTypes.STRING, allowNull: true },
    genre: { type: DataTypes.STRING, allowNull: true }
});

// Таблица цен для каждой платформы
const Price = sequelize.define('price', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    original_price: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    discount_percent: { type: DataTypes.INTEGER, defaultValue: 0 },
    platform: { type: DataTypes.STRING, allowNull: false },
    external_id: { type: DataTypes.STRING, allowNull: true, unique: true },
    url: { type: DataTypes.STRING, allowNull: true }
}, {
    indexes: [
        // Одна цена на платформу для каждой игры — основа для upsert и защита от дублей
        { unique: true, fields: ['game_id', 'platform'] }
    ]
});

const PriceHistory = sequelize.define('price_history', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

// Связи:
// одна игра имеет много записей истории цен (FK: game_id — единообразно с парсерами)
Game.hasMany(PriceHistory, { foreignKey: 'game_id' });
PriceHistory.belongsTo(Game, { foreignKey: 'game_id' });

// Одна игра может иметь цены на разных платформах
Game.hasMany(Price, { foreignKey: 'game_id' });
Price.belongsTo(Game, { foreignKey: 'game_id' });

module.exports = { Game, Price, PriceHistory };