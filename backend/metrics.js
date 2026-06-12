const express = require('express');
const client  = require('prom-client');

const app = express();

client.collectDefaultMetrics({ prefix: 'parsers_' });

const gamesParsedCounter = new client.Counter({
    name:       'games_parsed_total',
    help:       'Total number of games saved to DB',
    labelNames: ['platform'],
});

const apiErrorsCounter = new client.Counter({
    name:       'api_errors_total',
    help:       'Total number of external API errors',
    labelNames: ['platform'],
});

const gamesSkippedCounter = new client.Counter({
    name:       'games_skipped_total',
    help:       'Total number of apps skipped (not a game / no data)',
    labelNames: ['platform'],
});

const batchDurationHistogram = new client.Histogram({
    name:       'parser_batch_duration_seconds',
    help:       'Duration of one processing batch in seconds',
    labelNames: ['platform'],
    buckets:    [0.5, 1, 2, 5, 10, 20, 30],
});

const queueSizeGauge = new client.Gauge({
    name:       'parser_queue_remaining',
    help:       'Number of games still in the processing queue',
    labelNames: ['platform'],
});

const parserRunningGauge = new client.Gauge({
    name:       'parser_running',
    help:       '1 if parser is currently running, 0 otherwise',
    labelNames: ['platform'],
});

app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

function startMetricsServer(port = 9090) {
    app.listen(port, () => {
        console.log(`Metrics server: http://localhost:${port}/metrics`);
    });
}

module.exports = {
    startMetricsServer,
    gamesParsedCounter,
    apiErrorsCounter,
    gamesSkippedCounter,
    batchDurationHistogram,
    queueSizeGauge,
    parserRunningGauge,
};