const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('Missing MONGODB_URI env var');
  }

  await mongoose.connect(uri);
  return mongoose.connection;
}

module.exports = { connectDB };
