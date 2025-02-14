const { MongoClient } = require('mongodb');
const MONGO_URI = "mongodb://faiz:faiz@localhost:27017/scraper?authSource=admin";
const RESOLUTIONS = ['480p', '720p', '1080p'];
let client = null;
async function connectToDb() {
  if (!client) {
    client = new MongoClient(MONGO_URI, { useUnifiedTopology: true });
    await client.connect();
    console.log('Connected to MongoDB');
  }
  return client;
}
async function getDb() {
  await connectToDb();
  return client.db();
}
async function getCollection(collectionName) {
  const db = await getDb();
  return db.collection(collectionName);
}
async function closeConnection() {
  if (client) {
    await client.close();
    console.log('MongoDB connection closed');
    client = null;
  }
}
async function processAllPosts(scrapeCallback) {
  const collection = await getCollection('posts');
  const cursor = collection.find({
    isScraped: true,
    $or: RESOLUTIONS.map(res => ({ [res]: { $exists: true } }))
  }).batchSize(5);
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    console.log(`\nProcessing document ${doc._id} - ${doc.title}`);
    await processDocument(doc, collection, scrapeCallback);
  }
}
async function processDocument(doc, collection, scrapeCallback) {
  const updates = {
    directUrls: {},
    errors: {},
    processingLog: []
  };
  for (const res of RESOLUTIONS) {
    const url = doc[res];
    if (!url) continue;
    try {
      updates.processingLog.push(`${new Date().toISOString()} - Starting ${res} processing`);
      const directUrl = await scrapeCallback(url);
      updates.directUrls[res] = directUrl;
      updates.processingLog.push(`${new Date().toISOString()} - ${res} success: ${directUrl}`);
    } catch (error) {
      updates.errors[res] = {
        message: error.message,
        stack: error.stack
      };
      updates.processingLog.push(`${new Date().toISOString()} - ${res} error: ${error.message}`);
    }
  }
  updates.lastProcessed = new Date();
  await collection.updateOne(
    { _id: doc._id },
    {
      $set: updates,
      $inc: { processingAttempts: 1 }
    }
  );
}
module.exports = {
  getDb,
  getCollection,
  closeConnection,
  processAllPosts,
  processDocument,
};
