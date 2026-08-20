'use strict';

const { getConnectionState } = require('../db');

/** Liveness: the process is up and serving. Never touches the database. */
function getHealth(req, res) {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
}

/** Readiness: dependencies are usable, so a load balancer can route traffic. */
function getReadiness(req, res) {
  const db = getConnectionState();
  res.status(db.connected ? 200 : 503).json({
    status: db.connected ? 'ready' : 'not-ready',
    db: db.status,
    uptimeSeconds: Math.round(process.uptime())
  });
}

module.exports = { getHealth, getReadiness };
