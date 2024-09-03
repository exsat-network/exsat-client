import { PROMETHEUS, PROMETHEUS_ADDRESS } from './config';
import { logger } from './logger';

const promClient = require('prom-client');
const express = require('express');
const httpRequestCounter = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'status'],
});

const errorTotalCounter = new promClient.Counter({
  name: 'exsat_node_error_total',
  help: 'Total count of errors that occurred in the exsat node',
  labelNames: ['account', 'client'],
});

const warnTotalCounter = new promClient.Counter({
  name: 'exsat_node_warn_total',
  help: 'Total count of warnings that occurred in the exsat node',
  labelNames: ['account', 'client'],
});

const blockValidateTotalCounter = new promClient.Counter({
  name: 'exsat_node_block_validate_total',
  help: 'Total count of successful validation block events for exsat nodes, categorized by account and status. Status can be "success" or "fail".',
  labelNames: ['account', 'client'],
});

const blockUploadTotalCounter = new promClient.Counter({
  name: 'exsat_node_block_upload_total',
  help: 'Total count of successful upload block events for exsat nodes, categorized by account and status. Status can be "init", "push", "parse", "verify_success", "verify_fail".',
  labelNames: ['account', 'client', 'status'],
});

const syncLatestBlockGauge = new promClient.Gauge({
  name: 'exsat_node_latest_sync_block',
  help: 'Latest sync block',
  labelNames: ['account', 'client'],
});

const validateLatestBlockGauge = new promClient.Gauge({
  name: 'exsat_node_latest_validate_block',
  help: 'Latest validate block',
  labelNames: ['account', 'client'],
});


const syncLatestTimeGauge = new promClient.Gauge({
  name: 'exsat_node_latest_sync_time',
  help: 'Latest sync time',
  labelNames: ['account', 'client'],
});

const validateLatestTimeGauge = new promClient.Gauge({
  name: 'exsat_node_latest_validate_time',
  help: 'Latest validate time',
  labelNames: ['account', 'client'],
});

function createApp() {
  const app = express();

  // Create a Registry which registers the metrics
  const register = new promClient.Registry();

  // Collect default metrics and add them to the registry
  promClient.collectDefaultMetrics({ register });

  register.registerMetric(httpRequestCounter);
  register.registerMetric(errorTotalCounter);
  register.registerMetric(warnTotalCounter);
  register.registerMetric(blockValidateTotalCounter);
  register.registerMetric(blockUploadTotalCounter);
  register.registerMetric(syncLatestBlockGauge);
  register.registerMetric(validateLatestBlockGauge);

  // Endpoint to expose metrics
  app.get('/metrics', async (req, res) => {
    try {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    } catch (err) {
      res.status(500).end(err);
    }
  });

  // Middleware to count HTTP requests
  app.use((req, res, next) => {
    res.on('finish', () => {
      httpRequestCounter.inc({ method: req.method, status: res.statusCode });
    });
    next();
  });

  return app;
}

function setupPrometheus() {
  if (PROMETHEUS) {
    const ipPort = PROMETHEUS_ADDRESS.split(':');
    const app = createApp();
    app.listen(parseInt(ipPort[1]), ipPort[0], () => {
      logger.info(`Prometheus server is running on ${PROMETHEUS_ADDRESS}`);
    });
  }
}

export {
  createApp,
  setupPrometheus,
  errorTotalCounter,
  warnTotalCounter,
  blockValidateTotalCounter,
  blockUploadTotalCounter,
  syncLatestBlockGauge,
  validateLatestBlockGauge,
  syncLatestTimeGauge,
  validateLatestTimeGauge
};
