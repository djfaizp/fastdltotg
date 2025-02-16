const { MongoClient } = require('mongodb');
require('dotenv').config();
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'scraper';
const RESOLUTIONS = ['480p', '720p', '1080p'];
let client = null;
async function connectToDb() {
  if (!client) {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    console.log('Connected to MongoDB');
  }
  return client;
}
async function getDb() {
  await connectToDb();
  return client.db(DB_NAME);
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
    $or: [
      // Case 1: No directUrls yet
      ...RESOLUTIONS.map(res => ({
        [res]: { $exists: true },
        [`directUrls.${res}`]: { $exists: false },
        [`skippedUrls.${res}`]: { $exists: false }
      })),
      // Case 2: Has directUrls but not uploaded to Telegram
      ...RESOLUTIONS.map(res => ({
        [res]: { $exists: true },
        [`directUrls.${res}`]: { $exists: true },
        [`uploadedToTelegram.${res}`]: { $exists: false },
        [`skippedUrls.${res}`]: { $exists: false }
      }))
    ]
  }).batchSize(1);

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    console.log(`\nProcessing document ${doc._id} - ${doc.title}`);
    try {
      await processDocument(doc, collection, scrapeCallback);
      console.log(`✅ Completed processing document ${doc._id}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`❌ Error processing document ${doc._id}:`, error);
    }
  }
}
async function processDocument(doc, collection, scrapeCallback) {
    console.log('\n📝 Starting document processing:', {
        id: doc._id,
        title: doc.title,
        existingDirectUrls: doc.directUrls || 'none',
        uploadedStatus: doc.uploadedToTelegram || 'none'
    });

    const updates = {
        directUrls: {},
        errors: {},
        processingLog: [],
        skippedUrls: {}
    };

    for (const res of RESOLUTIONS) {
        const url = doc[res];
        if (!url) {
            console.log(`⏭️ Skipping ${res} - No URL found`);
            continue;
        }

        console.log(`\n🔄 Processing ${res} resolution:`);
        console.log('Source URL:', url);

        const currentFileName = url.split('/').pop();
        console.log('Current filename:', currentFileName);

        // Detailed upload status check
        if (doc.uploadedToTelegram?.[res]) {
            const logMessage = `${new Date().toISOString()} - ${res} already uploaded to Telegram`;
            console.log(`📤 ${logMessage}`);
            updates.processingLog.push(logMessage);
            continue;
        }

        // Detailed directUrl check
        if (doc.directUrls?.[res]) {
            const storedUrl = doc.directUrls[res];
            const storedFileName = storedUrl.split('/').pop();
            
            console.log('Comparing filenames:', {
                stored: storedFileName,
                current: currentFileName,
                match: storedFileName === currentFileName
            });

            if (storedFileName === currentFileName) {
                console.log(`🔄 Found matching directUrl for ${res}:`, {
                    storedUrl,
                    fileName: storedFileName
                });

                updates.processingLog.push(`${new Date().toISOString()} - ${res} filename matched: ${storedFileName}`);

                try {
                    console.log('🚀 Initiating Telegram upload for matched file...');
                    const { uploadToTelegram } = require('./telegram');
                    const caption = 
                        `🎬 Movie: ${doc.title || 'N/A'}\n` +
                        `🗣️ 🔊Language: ${doc.language || 'N/A'}\n` +
                        `🌍 Original Language: ${doc.originalLanguage || 'N/A'}\n` +
                        `⏱️ Runtime: ${doc.runtime || 'N/A'}\n` +
                        `🎭 Genres: ${doc.genres?.join(', ') || 'N/A'}`;

                    console.log('📋 Upload caption:', caption);

                    const telegramResult = await uploadToTelegram(storedUrl, caption);
                    console.log('📨 Telegram upload result:', telegramResult);

                    if (telegramResult.success) {
                        updates.directUrls[res] = storedUrl;
                        const successMsg = `${new Date().toISOString()} - ${res} uploaded to Telegram`;
                        updates.processingLog.push(successMsg);
                        
                        console.log('✅ Updating MongoDB with upload status...');
                        await collection.updateOne(
                            { _id: doc._id },
                            {
                                $set: {
                                    [`uploadedToTelegram.${res}`]: true,
                                    [`telegramLinks.${res}`]: telegramResult.messageLink
                                }
                            }
                        );
                        console.log('📝 MongoDB update completed');
                    } else {
                        console.warn('⚠️ Telegram upload failed:', {
                            error: telegramResult.error,
                            resolution: res,
                            fileName: storedFileName
                        });
                    }
                } catch (error) {
                    console.error('❌ Error during Telegram upload:', {
                        resolution: res,
                        error: error.message,
                        stack: error.stack
                    });
                    updates.errors[res] = {
                        message: error.message,
                        stack: error.stack,
                        timestamp: new Date().toISOString()
                    };
                }
                continue;
            } else {
                console.log(`📎 Different filename detected for ${res}:`, {
                    stored: storedFileName,
                    current: currentFileName
                });
            }
        }

        // Process new URL
        console.log(`🆕 Processing new URL for ${res}:`, url);
        try {
            updates.processingLog.push(`${new Date().toISOString()} - Starting ${res} processing`);
            const result = await scrapeCallback(url, doc, res);

            console.log('🔍 Scrape callback result:', {
                resolution: res,
                result: result,
                skipped: result?.skipped || false
            });

            if (result && result.skipped) {
                updates.skippedUrls[res] = {
                    url: result.url,
                    reason: result.reason,
                    timestamp: new Date().toISOString()
                };
                updates.processingLog.push(`${new Date().toISOString()} - ${res} skipped: ${result.reason}`);
                console.log('⏭️ Skipped processing:', updates.skippedUrls[res]);
            } else {
                updates.directUrls[res] = result;
                updates.processingLog.push(`${new Date().toISOString()} - ${res} success: ${result}`);
                
                console.log('✅ Updating MongoDB with new directUrl...');
                await collection.updateOne(
                    { _id: doc._id },
                    {
                        $set: {
                            [`directUrls.${res}`]: result,
                            lastProcessed: new Date(),
                            processingLog: updates.processingLog
                        }
                    }
                );
                console.log('📝 MongoDB update completed');
            }
            
            console.log('⏳ Waiting 2 seconds before next resolution...');
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            console.error('❌ Processing error:', {
                resolution: res,
                error: error.message,
                stack: error.stack
            });
            
            updates.errors[res] = {
                message: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            };
            updates.processingLog.push(`${new Date().toISOString()} - ${res} error: ${error.message}`);
            
            await collection.updateOne(
                { _id: doc._id },
                {
                    $set: {
                        [`errors.${res}`]: updates.errors[res],
                        processingLog: updates.processingLog
                    }
                }
            );
        }
    }

    console.log('\n📊 Final updates for document:', {
        id: doc._id,
        directUrlsCount: Object.keys(updates.directUrls).length,
        errorsCount: Object.keys(updates.errors).length,
        skippedCount: Object.keys(updates.skippedUrls).length,
        logEntries: updates.processingLog.length
    });

    await collection.updateOne(
        { _id: doc._id },
        {
            $set: updates,
            $inc: { processingAttempts: 1 }
        }
    );
    console.log('✅ Document processing completed\n');
}

module.exports = {
  getDb,
  getCollection,
  closeConnection,
  processAllPosts,
  processDocument,
};
