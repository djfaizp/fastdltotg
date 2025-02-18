const BaseWorker = require('./baseWorker');
const { downloadVideo } = require('../aria2');
const { PROCESSING_STATUS } = require('../db');

class Aria2Worker extends BaseWorker {
  constructor() {
    super('posts', {
      workerName: 'Aria2Worker',
      pollingInterval: 5000,
      errorRetryDelay: 10000,
      documentFilter: {
        processingStatus: { $in: [PROCESSING_STATUS.READY_FOR_ARIA2, PROCESSING_STATUS.DOWNLOADING_ARIA2] },
        directUrls: { $exists: true, $ne: {} },
        $or: [
          { 'aria2Status': { $exists: false } },
          { 'aria2Status': 'pending' },
          { 'aria2Status': 'processing' }
        ],
        'telegramStatus': { $in: [null, undefined] }
      },
      initialStatusUpdate: {
        $set: {
          aria2Status: {},
          startedAt: new Date()
        }
      },
      processDocument: async (doc, collection) => {
        console.log(`[Aria2Worker] Processing document ${doc._id}`);
        let successfulDownloads = 0;
        let totalAttempts = 0;

        // Initialize aria2Status as an object if it's a string or doesn't exist
        if (typeof doc.aria2Status === 'string' || !doc.aria2Status) {
          await collection.updateOne(
            { _id: doc._id },
            { $set: { aria2Status: {} } }
          );
        }

        for (const [resolution, url] of Object.entries(doc.directUrls)) {
          console.log(`[Aria2Worker] Starting download for ${resolution} from ${url}`);
          if (!url) {
            console.error(`[Aria2Worker] Skipping ${resolution} - URL is missing`);
            continue;
          }
          if (doc.uploadedToTelegram?.[resolution]) {
            console.warn(`[Aria2Worker] Skipping ${resolution} - already uploaded to Telegram`);
            continue;
          }
          totalAttempts++;
          try {
            const downloadResult = await downloadVideo(
              url,
              process.env.ARIA2_DOWNLOAD_DIR,
              { ...doc, resolution }
            );
            if (downloadResult.success) {
              successfulDownloads++;
              await collection.updateOne(
                { _id: doc._id },
                {
                  $set: {
                    [`aria2Status.${resolution}`]: 'completed',
                    processingStatus: PROCESSING_STATUS.READY_FOR_TELEGRAM
                  }
                }
              );
            }
          } catch (error) {
            console.error(`[Aria2Worker] Download failed for ${resolution}:`, error);
            await collection.updateOne(
              { _id: doc._id },
              {
                $set: {
                  [`aria2Status.${resolution}`]: 'error',
                  error: error.message
                }
              }
            );
          }
        }

        // Update final status based on download results
        if (totalAttempts === 0) {
          await collection.updateOne(
            { _id: doc._id },
            {
              $set: {
                processingStatus: PROCESSING_STATUS.ERROR,
                error: 'No valid URLs to process',
                completedAt: new Date()
              }
            }
          );
        } else if (successfulDownloads === 0) {
          await collection.updateOne(
            { _id: doc._id },
            {
              $set: {
                processingStatus: PROCESSING_STATUS.ERROR,
                error: 'All downloads failed',
                completedAt: new Date()
              }
            }
          );
        } else if (successfulDownloads < totalAttempts) {
          console.log(`[Aria2Worker] Partial success: ${successfulDownloads}/${totalAttempts} downloads completed`);
        }
      }
    });
  }
}

module.exports = Aria2Worker;
