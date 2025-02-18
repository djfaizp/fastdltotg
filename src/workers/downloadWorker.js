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
          { "480p": { $exists: true }, "directUrls.480p": { $exists: false } },
          { "720p": { $exists: true }, "directUrls.720p": { $exists: false } },
          { "1080p": { $exists: true }, "directUrls.1080p": { $exists: false } }
        ],
        processingStatus: { $in: [PROCESSING_STATUS.PENDING, null] }
      },
      initialStatusUpdate: {
        $set: {
          processingStatus: PROCESSING_STATUS.DOWNLOADING,
          startedAt: new Date()
        }
      },
      processDocument: async (doc, collection) => {
        logger.info(`[DownloadWorker] Processing ${doc._id}`);
        let browserInstance;
        let successfulUrls = 0;
        let totalAttempts = 0;

        try {
          browserInstance = await browserManager.createBrowserInstance();

          for (const resolution of ['480p', '720p', '1080p']) {
            // Skip if resolution URL doesn't exist or already processed
            if (!doc[resolution] || doc.directUrls?.[resolution]) {
              continue;
            }

            totalAttempts++;
            let retries = 3;
            let succeeded = false;

            while (retries > 0 && !succeeded) {
              try {
                const directUrl = await processUrl(doc[resolution], doc, resolution);
                if (directUrl) {
                  succeeded = true;
                  successfulUrls++;
                  logger.info(`[DownloadWorker] Got direct URL for ${resolution}: ${directUrl}`);
                  await collection.updateOne(
                    { _id: doc._id },
                    {
                      $set: {
                        [`directUrls.${resolution}`]: directUrl,
                        processingStatus: PROCESSING_STATUS.READY_FOR_ARIA2
                      }
                    }
                  );
                }
                break;
              } catch (error) {
                retries--;
                logger.error(`[DownloadWorker] Attempt ${3 - retries}/3 failed for ${resolution}:`, error);
                if (retries === 0) {
                  await collection.updateOne(
                    { _id: doc._id },
                    {
                      $set: {
                        [`errors.${resolution}`]: error.message,
                        lastErrorAt: new Date()
                      }
                    }
                  );
                }
              }
            }
          }

          // Update final status
          if (successfulUrls > 0) {
            await collection.updateOne(
              { _id: doc._id },
              {
                $set: {
                  processingStatus: PROCESSING_STATUS.READY_FOR_ARIA2,
                  completedAt: new Date()
                }
              }
            );
            logger.info(
              `[DownloadWorker] Updated document ${doc._id} with ${successfulUrls}/${totalAttempts} direct URLs`
            );
          } else {
            await collection.updateOne(
              { _id: doc._id },
              {
                $set: {
                  processingStatus: PROCESSING_STATUS.ERROR,
                  error: 'Failed to extract any direct URLs',
                  completedAt: new Date()
                }
              }
            );
          }
        } catch (error) {
          logger.error(`[DownloadWorker] Unexpected error processing ${doc._id}:`, error);
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
              logger.error('[DownloadWorker] Error closing browser:', err)
            );
          }
        }
      }
    });
  }
}

module.exports = DownloadWorker;
