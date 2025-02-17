const BaseWorker = require('./baseWorker');
const { PROCESSING_STATUS } = require('../db');
const { processUrl } = require('../processors');

class DownloadWorker extends BaseWorker {
  constructor() {
    super('posts', {
      workerName: 'DownloadWorker',
      pollingInterval: 5000,
      errorRetryDelay: 10000,
      documentFilter: { 
        isScraped: true,
        processingStatus: PROCESSING_STATUS.PENDING,
        $or: [
          { directUrls: { $exists: false } },
          { directUrls: {} }
        ]
      },
      initialStatusUpdate: {
        $set: {
          processingStatus: PROCESSING_STATUS.DOWNLOADING,
          startedAt: new Date()
        }
      },
      processDocument: async (doc, collection) => {
        console.log(`[DownloadWorker] Processing ${doc._id}`);
        const updates = {
          directUrls: {},
          processingStatus: PROCESSING_STATUS.READY_FOR_ARIA2,
          completedAt: new Date()
        };

        try {
          for (const res of ['480p', '720p', '1080p']) {
            if (!doc[res]) continue;
            updates.directUrls[res] = await processUrl(doc[res], doc, res);
          }
        } finally {
          await collection.updateOne({ _id: doc._id }, { $set: updates });
        }
      }
    });
  }
}
module.exports = DownloadWorker;