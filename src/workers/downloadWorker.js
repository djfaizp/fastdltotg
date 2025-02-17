const BaseWorker = require('./baseWorker');
const { PROCESSING_STATUS } = require('../db');
const { processUrl } = require('../processors');
const { logger } = require('../utils');
const browserManager = require('../utils/browser');

class DownloadWorker extends BaseWorker {
  constructor() {
    super('posts', {
      workerName: 'DownloadWorker',
      pollingInterval: 5000,
      errorRetryDelay: 10000,
      maxRetries: 3,
      documentFilter: {
        isScraped: true,
        $or: [
          { processingStatus: { $exists: false } },
          { processingStatus: PROCESSING_STATUS.PENDING }
        ]
      },
      initialStatusUpdate: {
        $set: {
          processingStatus: PROCESSING_STATUS.DOWNLOADING,
          startedAt: new Date()
        }
      },
      processDocument: async (doc, collection) => {
        logger.info(`[DownloadWorker] Processing ${doc._id}`);
        const updates = {
          directUrls: {},
          processingStatus: PROCESSING_STATUS.READY_FOR_ARIA2,
          completedAt: new Date()
        };

        let browserInstance;
        try {
          browserInstance = await browserManager.createBrowserInstance();
          
          for (const res of ['480p', '720p', '1080p']) {
            if (!doc[res]) continue;
            
            let retries = 3;
            while (retries > 0) {
              try {
                const directUrl = await processUrl(doc[res], doc, res);
                if (directUrl) {
                  updates.directUrls[res] = directUrl;
                  logger.info(`[DownloadWorker] Got direct URL for ${res}: ${directUrl}`);
                }
                break;
              } catch (error) {
                retries--;
                if (retries === 0) {
                  logger.error(`[DownloadWorker] Failed to get direct URL for ${res} after all retries`);
                  throw error;
                }
                logger.warn(`[DownloadWorker] Retrying ${res} for ${doc._id}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
          }

          // Only update if we have at least one direct URL
          if (Object.keys(updates.directUrls).length > 0) {
            await collection.updateOne(
              { _id: doc._id },
              { $set: updates }
            );
            logger.info(`[DownloadWorker] Updated document with direct URLs: ${JSON.stringify(updates.directUrls)}`);
          } else {
            throw new Error('No direct URLs were obtained');
          }

        } catch (error) {
          logger.error(`[DownloadWorker] Failed to process ${doc._id}:`, error);
          await collection.updateOne(
            { _id: doc._id },
            {
              $set: {
                processingStatus: PROCESSING_STATUS.ERROR,
                error: error.message,
                completedAt: new Date()
              }
            }
          );
        } finally {
          if (browserInstance) {
            await browserManager.closeBrowserInstance(browserInstance).catch(err => 
              logger.error('[DownloadWorker] Error closing browser:', err));
          }
        }
      }
    });
  }
}

module.exports = DownloadWorker;
