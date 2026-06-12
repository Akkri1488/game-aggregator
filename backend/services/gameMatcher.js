const { Game } = require('../models');
const sequelize = require('../db');

// Функция нормализации строки (очистка от мусора)
function normalizeString(str) {
    if (!str) return '';
    return str
        .replace(/™|®|©/g, '')
        .replace(/[:\-]/g, ' ')
        .replace(/[^\w\sа-яё]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Атомарный поиск-или-создание игры.
// findOrCreate выполняется в одной операции и опирается на unique-индекс по title,
// что исключает дубликаты при параллельной обработке батча (Promise.all).
async function findOrCreateGame(title, developer, genre) {
    if (!title) return null;

    const cleanTitle = normalizeString(title);
    if (!cleanTitle) return null;

    try {
        const [game, created] = await Game.findOrCreate({
            where: sequelize.where(
                sequelize.fn('LOWER', sequelize.col('title')),
                cleanTitle.toLowerCase()
            ),
            defaults: { title: cleanTitle, developer, genre }
        });

        if (!created) {
            const updates = {};
            if (!game.developer && developer) updates.developer = developer;
            if (!game.genre && genre)         updates.genre     = genre;
            if (Object.keys(updates).length > 0) {
                await game.update(updates);
            }
        }

        return game;
    } catch (e) {
        // На случай гонки: параллельный запрос успел создать ту же игру между
        // нашим SELECT и INSERT -> ловим конфликт уникальности и до-читываем запись.
        if (e.name === 'SequelizeUniqueConstraintError') {
            return Game.findOne({
                where: sequelize.where(
                    sequelize.fn('LOWER', sequelize.col('title')),
                    cleanTitle.toLowerCase()
                )
            });
        }
        throw e;
    }
}

module.exports = { findOrCreateGame, normalizeString };