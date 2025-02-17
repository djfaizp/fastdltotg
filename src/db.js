const { MongoClient } = require('mongodb');
require('dotenv').config();

const client = new MongoClient(process.env.MONGO_URI, {
  maxPoolSize: 5,
  minPoolSize: 1,
  connectTimeoutMS: 3000,
  serverSelectionTimeoutMS: 3000,
  socketTimeoutMS: 2000
});

let dbConnection = null;
let isConnecting = false;

module.exports = {
  connect: async () => {
    if (dbConnection) return dbConnection;
    if (isConnecting) {
      await new Promise(resolve => setTimeout(resolve, 100));
      return dbConnection;
    }

    try {
      isConnecting = true;
      await client.connect();
      dbConnection = client.db(process.env.MONGO_DB);
      console.log('✅ MongoDB Connected');
      return dbConnection;
    } catch (error) {
      console.error('❌ MongoDB Connection Failed:', error);
      throw error;
    } finally {
      isConnecting = false;
    }
  },

  connect: async () => {
    if (dbConnection) {
      console.log('[MongoDB] Using existing connection');
      return dbConnection;
    }

    console.log('[MongoDB] Establishing new connection...');
    if (isConnecting) {
      console.log('[MongoDB] Waiting for existing connection attempt...');
      while (isConnecting) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return dbConnection;
    }

    try {
      isConnecting = true;
      await client.connect();
      dbConnection = client.db(process.env.MONGO_DB);
      console.log('📦 Connected to MongoDB (new connection)');
      
      // Add error listeners
      client.on('serverClosed', (e) => console.log('[MongoDB] Connection closed:', e));
      client.on('serverOpening', (e) => console.log('[MongoDB] Reconnecting:', e));
      client.on('serverHeartbeatFailed', (e) => console.error('[MongoDB] Heartbeat failed:', e));
      
      return dbConnection;
    } catch (error) {
      console.error('[MongoDB] Connection failed:', error);
      throw error;  // Propagate error to caller
    } finally {
      isConnecting = false;
    }
  },

  
  getCollection: async (name) => {
    const db = await module.exports.connect();
    return db.collection(name);
  },
  
  close: async () => {
    if (client) {
      await client.close();
      dbConnection = null;
      console.log('📦 MongoDB connection closed');
    }
  },
  
  PROCESSING_STATUS: Object.freeze({
    PENDING: 'pending',
    DOWNLOADING: 'downloading',
    READY_FOR_ARIA2: 'ready_for_aria2',
    DOWNLOADING_ARIA2: 'downloading_aria2',
    READY_FOR_TELEGRAM: 'ready_for_telegram',
    UPLOADING_TELEGRAM: 'uploading_telegram',
    COMPLETED: 'completed',
    ERROR: 'error'
  }),
};
