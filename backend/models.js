const { DataTypes } = require('sequelize');
const sequelize = require('./db');

// Единая таблица игр (общие данные)
const Game = sequelize.define('game', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    title: { type: DataTypes.STRING, allowNull: false },
    developer: { type: DataTypes.STRING, allowNull: true },
    genre: { type: DataTypes.STRING, allowNull: true }
});

// Таблица цен для каждой платформы
const Price = sequelize.define('price', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },       // Текущая цена
    original_price: { type: DataTypes.DECIMAL(10, 2), allowNull: true }, // Исходная цена
    discount_percent: { type: DataTypes.INTEGER, defaultValue: 0 },      // Скидка в %
    platform: { type: DataTypes.STRING, allowNull: false },
    external_id: { type: DataTypes.STRING, allowNull: true },
    url: { type: DataTypes.STRING, allowNull: true }
});

const PriceHistory = sequelize.define('price_history', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

// Связи:
// одна игра имеет много записей истории цен
Game.hasMany(PriceHistory, { foreignKey: 'gameId' });
PriceHistory.belongsTo(Game, { foreignKey: 'gameId' });

// Одна игра может иметь цены на разных платформах
Game.hasMany(Price, { foreignKey: 'game_id' });
Price.belongsTo(Game, { foreignKey: 'game_id' });

module.exports = { Game, Price, PriceHistory };