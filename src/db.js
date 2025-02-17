const { MongoClient } = require('mongodb');
const NodeCache = require('node-cache');
require('dotenv').config();

// Initialize cache with 5 minute TTL
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// Connection settings
const connectionSettings = {
  maxPoolSize: 10, // Increased from 5
  minPoolSize: 2,
  connectTimeoutMS: 5000,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 3000,
  retryWrites: true,
  retryReads: true,
  heartbeatFrequencyMS: 10000
};

const client = new MongoClient(process.env.MONGO_URI, connectionSettings);
let dbConnection = null;
let isConnecting = false;

// Create indexes on startup
async function createIndexes(db) {
  try {
    const postsCollection = db.collection('posts');
    await postsCollection.createIndex({ processingStatus: 1 });
    await postsCollection.createIndex({ isScraped: 1 });
    await postsCollection.createIndex({ startedAt: -1 });
    console.log('📦 MongoDB indexes created');
  } catch (error) {
    console.error('❌ Failed to create indexes:', error);
  }
}

module.exports = {
  connect: async (mongoDatabaseName) => {
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
      dbConnection = client.db(mongoDatabaseName);
      
      // Create indexes on first connection
      await createIndexes(dbConnection);
      
      console.log('📦 Connected to MongoDB (new connection)');
      
      // Add error listeners
      client.on('serverClosed', (e) => {
        console.log('[MongoDB] Connection closed:', e);
        dbConnection = null;
      });
      
      client.on('serverOpening', (e) => {
        console.log('[MongoDB] Reconnecting:', e);
      });
      
      client.on('serverHeartbeatFailed', (e) => {
        console.error('[MongoDB] Heartbeat failed:', e);
      });
      
      return dbConnection;
    } catch (error) {
      console.error('[MongoDB] Connection failed:', error);
      throw error;
    } finally {
      isConnecting = false;
    }
  },

  getCollection: async (name) => {
    const db = await module.exports.connect(process.env.MONGO_DB);
    return db.collection(name);
  },

  getCachedCollection: async (name) => {
    const cacheKey = `collection_${name}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    const collection = await module.exports.getCollection(name);
    cache.set(cacheKey, collection);
    return collection;
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
