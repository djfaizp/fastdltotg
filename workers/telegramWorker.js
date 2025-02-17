const BaseWorker = require('./baseWorker');
const { PROCESSING_STATUS } = require('../db');
const { uploadToTelegram } = require('../telegram');
const { formatCaption, formatMetadata } = require('../aria2');
const path = require('path');

class TelegramWorker extends BaseWorker {
  constructor() {
    super('posts', {
      workerName: 'TelegramWorker',
      pollingInterval: 5000,
      errorRetryDelay: 10000,
      documentFilter: {
        processingStatus: PROCESSING_STATUS.READY_FOR_TELEGRAM,
        uploadedToTelegram: { $exists: true }
      },
      initialStatusUpdate: {
        $set: {
          processingStatus: PROCESSING_STATUS.UPLOADING_TELEGRAM,
          startedAt: new Date()
        }
      },
      processDocument: async (doc, collection) => {
        console.log(`[TelegramWorker] Processing uploads for ${doc._id}`);
        for (const resolution of ['480p', '720p', '1080p']) {
          console.log(`[TelegramWorker] Checking ${resolution} for upload`);
          if (!doc.directUrls?.[resolution] || !doc.uploadedToTelegram?.[resolution]) continue;
          
          const filePath = path.join(
            process.env.ARIA2_DOWNLOAD_DIR,
            path.basename(doc.directUrls[resolution])
          );
          
          const metadata = formatMetadata(doc, resolution);
          const caption = formatCaption(metadata, path.basename(filePath));
          
          const uploadResult = await uploadToTelegram(filePath, caption);
          console.log(`[TelegramWorker] ${resolution} uploaded successfully`);

          if (uploadResult.success) {
            await collection.updateOne(
              { _id: doc._id },
              {
                $set: {
                  [`telegramLinks.${resolution}`]: uploadResult.messageLink,
                  processingStatus: PROCESSING_STATUS.COMPLETED,
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

module.exports = TelegramWorker;