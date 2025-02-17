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
        processingStatus: PROCESSING_STATUS.READY_FOR_ARIA2,
        directUrls: { $exists: true, $ne: {} }
      },
      initialStatusUpdate: {
        $set: {
          processingStatus: PROCESSING_STATUS.DOWNLOADING_ARIA2,
          startedAt: new Date()
        }
      },
      processDocument: async (doc, collection) => {
        console.log(`[Aria2Worker] Processing direct URLs for ${doc._id}`);
        for (const [resolution, url] of Object.entries(doc.directUrls)) {
          console.log(`[Aria2Worker] Downloading ${resolution} from ${url}`);
          if (!url || doc.uploadedToTelegram?.[resolution]) continue;
          
          const downloadResult = await downloadVideo(
            url,
            process.env.ARIA2_DOWNLOAD_DIR,
            { ...doc, resolution }
          );
          console.log(`[Aria2Worker] ${resolution} download completed for ${doc._id}`);
          if (downloadResult.success) {
            await collection.updateOne(
              { _id: doc._id },
              {
                $set: {
                  [`uploadedToTelegram.${resolution}`]: true,
                  processingStatus: PROCESSING_STATUS.READY_FOR_TELEGRAM,
                  completedAt: new Date()
                }
              }
            );
          }
        }
      }
    });
  }
}

module.exports = Aria2Worker;