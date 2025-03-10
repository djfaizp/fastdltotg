import { MongoClient } from 'mongodb';
import NodeCache from 'node-cache';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'scraper';
const RESOLUTIONS = ['480p', '720p', '1080p'];
let client = null;

/**
 * Connects to MongoDB
 * @returns {Promise<MongoClient>}
 */
async function connectToDb() {
    if (!client) {
        client = new MongoClient(MONGO_URI);
        await client.connect();
        console.log('Connected to MongoDB');
    }
    return client;
}

/**
 * Gets MongoDB database instance
 * @returns {Promise<Db>}
 */
async function getDb() {
    await connectToDb();
    return client.db(DB_NAME);
}

/**
 * Gets MongoDB collection
 * @param {string} collectionName - Name of the collection
 * @returns {Promise<Collection>}
 */
async function getCollection(collectionName) {
    const db = await getDb();
    return db.collection(collectionName);
}

/**
 * Closes MongoDB connection
 * @returns {Promise<void>}
 */
async function closeConnection() {
    if (client) {
        await client.close();
        console.log('MongoDB connection closed');
        client = null;
    }
}

// Initialize cache with 1 hour standard TTL and strict validation
const processCache = new NodeCache({
    stdTTL: 3600, // 1 hour
    checkperiod: 600, // Check for expired keys every 10 minutes
    useClones: false,
    deleteOnExpire: true, // Automatically delete expired entries
    maxKeys: 1000 // Prevent memory overconsumption
});

/**
 * Generates a unique cache key for a document
 * @param {string} docId - Document ID
 * @param {string} type - Cache entry type (logs, errors, etc.)
 * @returns {string} Cache key
 */
const getCacheKey = (docId, type) => `doc_${docId}_${type}`;

/**
 * Processes all posts that need scraping or Telegram uploading
 * @param {Function} scrapeCallback - Callback function to handle scraping
 * @returns {Promise<void>}
 */
async function processAllPosts(scrapeCallback) {
    const collection = await getCollection('posts');
    const cursor = collection.find({
        isScraped: true,
        $or: [
            ...RESOLUTIONS.map(res => ({
                [res]: { $exists: true },
                [`directUrls.${res}`]: { $exists: false },
                [`skippedUrls.${res}`]: { $exists: false },
                [`telegramLinks.${res}`]: { $exists: false }
            })),
            ...RESOLUTIONS.map(res => ({
                [res]: { $exists: true },
                [`directUrls.${res}`]: { $exists: true },
                [`uploadedToTelegram.${res}`]: { $exists: false },
                [`skippedUrls.${res}`]: { $exists: false },
                [`telegramLinks.${res}`]: { $exists: false }
            }))
        ]
    }).batchSize(1);

    try {
        while (await cursor.hasNext()) {
            const doc = await cursor.next();
            console.log(`\nProcessing document ${doc._id} - ${doc.title}`);
            try {
                await processDocument(doc, collection, scrapeCallback);
                console.log(`✅ Completed processing document ${doc._id}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.error(`❌ Error processing document ${doc._id}:`, error);
                // Store error in cache
                const errorKey = getCacheKey(doc._id, 'processing_error');
                processCache.set(errorKey, {
                    timestamp: new Date(),
                    error: error.message,
                    stack: error.stack
                });
            }
        }
    } finally {
        await cursor.close();
    }
}

/**
 * Processes a single document for scraping and uploading
 * @param {Object} doc - Document to process
 * @param {Collection} collection - MongoDB collection
 * @param {Function} scrapeCallback - Callback function to handle scraping
 * @returns {Promise<void>}
 */
async function processDocument(doc, collection, scrapeCallback) {
    const docId = doc._id.toString();
    const logsKey = getCacheKey(docId, 'logs');
    const errorsKey = getCacheKey(docId, 'errors');
    
    // Initialize cache entries
    let processingLogs = processCache.get(logsKey) || [];
    let processingErrors = processCache.get(errorsKey) || {};

    for (const res of RESOLUTIONS) {
        const url = doc[res];
        if (!url) {
            processingLogs.push(`${new Date().toISOString()} - Skipping ${res} - No URL found`);
            continue;
        }

        console.log(`\n🔄 Processing ${res} resolution:`);
        
        // Check if already uploaded to Telegram or skipped
        if (doc.uploadedToTelegram?.[res] || doc.skippedUrls?.[res] || doc.telegramLinks?.[res]) {
            const skipReason = doc.uploadedToTelegram?.[res] ? 'already uploaded to Telegram' :
                             doc.telegramLinks?.[res] ? 'has existing Telegram link' :
                             doc.skippedUrls?.[res]?.reason || 'previously skipped';
            
            const logMessage = `${new Date().toISOString()} - ${res} skipped: ${skipReason}`;
            processingLogs.push(logMessage);
            continue;
        }

        try {
            processingLogs.push(`${new Date().toISOString()} - Starting ${res} processing`);
            const result = await scrapeCallback(url, doc, res);

            if (result && result.skipped) {
                // Update MongoDB for all skip reasons
                await collection.updateOne(
                    { _id: doc._id },
                    {
                        $set: {
                            [`skippedUrls.${res}`]: {
                                url: result.url,
                                reason: result.reason,
                                timestamp: new Date()
                            }
                        }
                    }
                );
                // Store skip in cache
                processingLogs.push(`${new Date().toISOString()} - ${res} skipped: ${result.reason}`);
            } else if (result?.telegramLink) {
                // Only update Telegram message link in MongoDB
                await collection.updateOne(
                    { _id: doc._id },
                    {
                        $set: {
                            [`uploadedToTelegram.${res}`]: true,
                            [`telegramLinks.${res}`]: result.telegramLink
                        }
                    }
                );
                // Store success in cache
                processingLogs.push(`${new Date().toISOString()} - ${res} uploaded to Telegram`);
            }
            
            // Store all logs in cache only
            processCache.set(logsKey, processingLogs);

            // Cache update
            processCache.set(logsKey, processingLogs);
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            processingErrors[res] = {
                message: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            };
            processingLogs.push(`${new Date().toISOString()} - ${res} error: ${error.message}`);
            
            // Update cache with errors
            processCache.set(errorsKey, processingErrors);
            processCache.set(logsKey, processingLogs);
        }
    }

    // No explicit cache updates needed - all changes were tracked in real-time
    // Cache will automatically persist based on TTL settings
}

/**
 * Retrieves cached processing logs for a document
 * @param {string} docId - Document ID
 * @returns {Array} Array of processing logs
 */
function getProcessingLogs(docId) {
    return processCache.get(getCacheKey(docId, 'logs')) || [];
}

/**
 * Retrieves cached processing errors for a document
 * @param {string} docId - Document ID
 * @returns {Object} Processing errors object
 */
function getProcessingErrors(docId) {
    return processCache.get(getCacheKey(docId, 'errors')) || {};
}

export {
    getDb,
    getCollection,
    closeConnection,
    processAllPosts,
    processDocument,
    getProcessingLogs,
    getProcessingErrors
};
