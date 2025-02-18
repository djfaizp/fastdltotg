const BaseWorker = require('./baseWorker');
const { PROCESSING_STATUS } = require('../db');
const { uploadToTelegram } = require('../telegram');
const { formatCaption, formatMetadata } = require('../aria2');
const { safeDelete } = require('../utils');
const path = require('path');

class TelegramWorker extends BaseWorker {
  constructor() {
    super('posts', {
      workerName: 'TelegramWorker',
      pollingInterval: 5000,
      errorRetryDelay: 10000,
      documentFilter: {
        processingStatus: PROCESSING_STATUS.READY_FOR_TELEGRAM,
        'aria2Status': 'completed',  // Only process documents completed by aria2
        'telegramStatus': { $ne: 'completed' }  // Only process documents not completed by telegram
      },
      initialStatusUpdate: {
        $set: {
          processingStatus: PROCESSING_STATUS.UPLOADING_TELEGRAM,
          telegramStatus: 'processing',
          startedAt: new Date()
        }
      },
      processDocument: async (doc, collection) => {
        console.log(`[TelegramWorker] Processing uploads for ${doc._id}`);
        const filesToDelete = [];
        
        try {
          // Get the downloaded file path from aria2 completion data
          const filePath = doc.aria2DownloadPath;
          if (!filePath) {
            throw new Error('Download path not found in document');
          }

          filesToDelete.push(filePath);
          
          // Get resolution from aria2 metadata
          const resolution = doc.currentResolution;
          if (!resolution) {
            throw new Error('Resolution information not found');
          }

          console.log(`[TelegramWorker] Uploading ${resolution} file: ${filePath}`);
          
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
                  telegramStatus: 'completed',
                  completedAt: new Date()
                }
              }
            );
          } else {
            throw new Error(`Upload failed for ${resolution}: ${uploadResult.error}`);
          }

          // Delete file after successful upload
          for (const filePath of filesToDelete) {
            try {
              await safeDelete(filePath);
              console.log(`[TelegramWorker] Successfully deleted file: ${filePath}`);
            } catch (deleteError) {
              console.error(`[TelegramWorker] Failed to delete file ${filePath}:`, deleteError);
            }
          }

        } catch (error) {
          console.error(`[TelegramWorker] Error processing ${doc._id}:`, error);
          await collection.updateOne(
            { _id: doc._id },
            {
              $set: {
                processingStatus: PROCESSING_STATUS.ERROR,
                telegramStatus: 'error',
                error: error.message,
                completedAt: new Date()
              }
            }
          );
          throw error;
        }
      }
    });
  }
}

module.exports = TelegramWorker;
