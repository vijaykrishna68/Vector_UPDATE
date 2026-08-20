const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('Missing MONGODB_URI env var');
  }

  await mongoose.connect(uri);
  return mongoose.connection;
}

// mongoose.connection.readyState is a numeric enum; map it for /health.
const READY_STATES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
  99: 'uninitialized'
};

function getConnectionState() {
  const readyState = mongoose.connection.readyState;
  return {
    readyState,
    status: READY_STATES[readyState] || 'unknown',
    connected: readyState === 1
  };
}

module.exports = { connectDB, getConnectionState };
