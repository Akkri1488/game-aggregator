const { Game } = require('../models');
const sequelize = require('../db');

// Функция нормализации строки (очистка от мусора)
function normalizeString(str) {
    if (!str) return '';
    return str
        .replace(/™|®|©/g, '') // Удаляем торговые марки
        .replace(/[:\-]/g, ' ') // Заменяем двоеточия и тире на пробелы (частая причина несовпадений)
        .replace(/[^\w\sа-яё]/gi, '') // Удаляем всю остальную пунктуацию (апострофы, запятые)
        .replace(/\s+/g, ' ') // Заменяем множественные пробелы на один
        .trim();
}

async function findOrCreateGame(title, developer, genre) {
    if (!title) return null;

    // 1. Очищаем название ОДИН РАЗ
    const cleanTitle = normalizeString(title);

    // 2. Ищем по очищенному названию
    const existing = await Game.findOne({
        where: sequelize.where(
            sequelize.fn('LOWER', sequelize.col('title')),
            sequelize.fn('LOWER', cleanTitle)
        )
    });

    if (existing) {
        // Обновляем данные, если их не было
        const updates = {};
        if (!existing.developer && developer) updates.developer = developer;
        if (!existing.genre && genre)         updates.genre     = genre;

        if (Object.keys(updates).length > 0) {
            await existing.update(updates);
        }
        return existing;
    }

    // 3. СОХРАНЯЕМ тоже очищенное название, чтобы в будущем поиск работал корректно!
    return Game.create({ title: cleanTitle, developer, genre });
}

module.exports = { findOrCreateGame };