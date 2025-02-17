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
          // Create browser instance using browser manager
          browserInstance = await browserManager.createBrowserInstance();
          const browser = browserInstance.browser;

          // Process each resolution with retry logic
          for (const res of ['480p', '720p', '1080p']) {
            if (!doc[res]) continue;
            
            let retries = 3;
            while (retries > 0) {
              try {
                updates.directUrls[res] = await processUrl(doc[res], doc, res, browser);
                break;
              } catch (error) {
                retries--;
                if (retries === 0) {
                  // Capture screenshot for debugging
                  const page = await browser.newPage();
                  try {
                    await page.goto(doc[res]);
                    await page.screenshot({ 
                      path: `debug/${doc._id}-${res}-error.png`,
                      fullPage: true 
                    });
                  } catch (screenshotError) {
                    logger.error('Failed to capture screenshot:', screenshotError);
                  }
                  await page.close();
                  throw error;
                }
                logger.warn(`[DownloadWorker] Retrying ${res} for ${doc._id}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
          }

          await connection.close();
        } catch (error) {
          logger.error(`[DownloadWorker] Failed to process ${doc._id}:`, error);
          updates.processingStatus = PROCESSING_STATUS.ERROR;
          updates.error = error.message;
        } finally {
          if (browserInstance) {
            await browserManager.closeBrowserInstance(browserInstance).catch(err =>
              logger.error(`[DownloadWorker] Error closing browser:`, err)
            );
          }
          try {
            await collection.updateOne(
              { _id: doc._id },
              { $set: updates },
              { timeout: 5000 }
            );
          } catch (error) {
            logger.error(`[DownloadWorker] Failed to update ${doc._id}:`, error);
          }
        }
      }
    });
  }
}

module.exports = DownloadWorker;
