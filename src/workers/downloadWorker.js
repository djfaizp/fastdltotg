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
        $and: [
          { processingStatus: { $in: [PROCESSING_STATUS.PENDING, null] } },
          { 'aria2Status': { $exists: false } },
          { 'telegramStatus': { $exists: false } }
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
        let browserInstance;
        let successfulUrls = 0;
        let totalAttempts = 0;
        const updates = { directUrls: {} };

        try {
          browserInstance = await browserManager.createBrowserInstance();

          for (const resolution of ['480p', '720p', '1080p']) {
            if (!doc[resolution]) continue;

            totalAttempts++;
            let retries = 3;
            let succeeded = false;

            while (retries > 0 && !succeeded) {
              try {
                const directUrl = await processUrl(doc[resolution], doc, resolution);
                if (directUrl) {
                  updates.directUrls[resolution] = directUrl;
                  succeeded = true;
                  successfulUrls++;
                  logger.info(`[DownloadWorker] Got direct URL for ${resolution}: ${directUrl}`);
                  
                  // Update the document immediately for this resolution
                  await collection.updateOne(
                    { _id: doc._id },
                    {
                      $set: {
                        [`directUrls.${resolution}`]: directUrl,
                        [`processingStatus.${resolution}`]: PROCESSING_STATUS.READY_FOR_ARIA2,
                        [`lastUpdated.${resolution}`]: new Date()
                      }
                    }
                  );
                }
                break;
              } catch (error) {
                retries--;
                if (retries === 0) {
                  logger.error(`[DownloadWorker] Failed to get direct URL for ${resolution} after all retries`);
                  // Mark this resolution as failed
                  await collection.updateOne(
                    { _id: doc._id },
                    {
                      $set: {
                        [`processingStatus.${resolution}`]: PROCESSING_STATUS.ERROR,
                        [`error.${resolution}`]: error.message,
                        [`lastUpdated.${resolution}`]: new Date()
                      }
                    }
                  );
                } else {
                  logger.warn(`[DownloadWorker] Retrying ${resolution} for ${doc._id}, ${retries} attempts remaining`);
                  await new Promise(resolve => setTimeout(resolve, 1000));
                }
              }
            }
          }

          // Update final status based on results
          if (totalAttempts === 0) {
            await collection.updateOne(
              { _id: doc._id },
              {
                $set: {
                  processingStatus: PROCESSING_STATUS.ERROR,
                  error: 'No resolutions to process',
                  completedAt: new Date()
                }
              }
            );
          } else if (successfulUrls === 0) {
            await collection.updateOne(
              { _id: doc._id },
              {
                $set: {
                  processingStatus: PROCESSING_STATUS.ERROR,
                  error: 'Failed to get any direct URLs',
                  completedAt: new Date()
                }
              }
            );
          } else {
            // At least one resolution succeeded
            await collection.updateOne(
              { _id: doc._id },
              {
                $set: {
                  processingStatus: PROCESSING_STATUS.READY_FOR_ARIA2,
                  aria2Status: 'pending',
                  completedAt: new Date(),
                  partialSuccess: successfulUrls < totalAttempts
                }
              }
            );
            logger.info(
              `[DownloadWorker] Updated document ${doc._id} with ${successfulUrls}/${totalAttempts} direct URLs`
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
