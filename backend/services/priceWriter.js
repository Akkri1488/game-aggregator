const { Price, PriceHistory } = require('../models');

// Единая запись цены для всех платформ.
// 1. upsert конфликтует по unique-индексу (game_id, platform), поэтому повторный
//    парсинг обновляет строку цены, а не плодит дубли.
// 2. В историю цен пишем запись только если цена реально изменилась
//    (или истории ещё не было) — иначе таблица замусоривается на каждом прогоне.
async function savePrice({ gameId, price, originalPrice, discount, platform, externalId, url }) {
    await Price.upsert(
        {
            game_id:          gameId,
            price,
            original_price:   originalPrice,
            discount_percent: discount,
            platform,
            external_id:      externalId,
            url
        },
        { conflictFields: ['game_id', 'platform'] }
    );

    const last = await PriceHistory.findOne({
        where: { game_id: gameId },
        order: [['date', 'DESC']]
    });

    if (!last || Number(last.price) !== Number(price)) {
        await PriceHistory.create({ game_id: gameId, price });
    }
}

module.exports = { savePrice };