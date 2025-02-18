const BaseWorker = require('./baseWorker');
const { downloadVideo } = require('../aria2');
const { PROCESSING_STATUS } = require('../db');

function isValidUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'https:' && 
           urlObj.hostname.includes('googleusercontent.com') &&
           url.length > 50; // Basic validation for Google Drive URLs
  } catch {
    return false;
  }
}

function calculateProgress(totalBytes, completedBytes) {
  if (!totalBytes || !completedBytes || totalBytes <= 0) return 0;
  return Math.min(100, (completedBytes / totalBytes) * 100).toFixed(1);
}

class Aria2Worker extends BaseWorker {
  constructor() {
    super('posts', {
      workerName: 'Aria2Worker',
      pollingInterval: 5000,
      errorRetryDelay: 10000,
      documentFilter: {
        directUrls: { $exists: true, $ne: {} },
        $or: [
          // Normal processing conditions
          {
            processingStatus: { $ne: PROCESSING_STATUS.ERROR },
            $or: [
              { "aria2Status.480p": { $in: [null, 'pending', 'processing'] } },
              { "aria2Status.720p": { $in: [null, 'pending', 'processing'] } },
              { "aria2Status.1080p": { $in: [null, 'pending', 'processing'] } }
            ]
          },
          // Retry failed documents after 5 minutes
          {
            processingStatus: PROCESSING_STATUS.ERROR,
            completedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) }
          }
        ]
      },
      initialStatusUpdate: {
        $set: {
          processingStatus: PROCESSING_STATUS.DOWNLOADING_ARIA2,
          startedAt: new Date()
        }
      },
      processDocument: async (doc, collection) => {
        console.log(`[Aria2Worker] Processing document ${doc._id}`);
        let successfulDownloads = 0;
        let totalAttempts = 0;

        // Validate URLs first
        const invalidUrls = [];
        for (const [resolution, url] of Object.entries(doc.directUrls)) {
          if (!isValidUrl(url)) {
            invalidUrls.push(resolution);
          }
        }

        if (invalidUrls.length > 0) {
          console.log(`[Aria2Worker] Invalid URLs found for resolutions: ${invalidUrls.join(', ')}`);
          await collection.updateOne(
            { _id: doc._id },
            {
              $set: {
                processingStatus: PROCESSING_STATUS.ERROR,
                error: `Invalid URLs for resolutions: ${invalidUrls.join(', ')}`,
                needsReprocessing: true
              }
            }
          );
          return;
        }

        // Initialize aria2Status if needed
        if (!doc.aria2Status || typeof doc.aria2Status !== 'object') {
          await collection.updateOne(
            { _id: doc._id },
            { 
              $set: { 
                aria2Status: {
                  "480p": doc.directUrls["480p"] ? "pending" : null,
                  "720p": doc.directUrls["720p"] ? "pending" : null,
                  "1080p": doc.directUrls["1080p"] ? "pending" : null
                }
              } 
            }
          );
        }

        // Process each resolution
        for (const resolution of ['480p', '720p', '1080p']) {
          const url = doc.directUrls[resolution];
          
          if (!url) {
            console.log(`[Aria2Worker] Skipping ${resolution} - URL missing`);
            continue;
          }

          if (doc.aria2Status?.[resolution] === 'completed') {
            console.log(`[Aria2Worker] Skipping ${resolution} - already completed`);
            successfulDownloads++;
            continue;
          }

          totalAttempts++;
          
          try {
            // Mark as processing
            await collection.updateOne(
              { _id: doc._id },
              { $set: { [`aria2Status.${resolution}`]: 'processing' } }
            );

            const downloadResult = await downloadVideo(
              url,
              process.env.ARIA2_DOWNLOAD_DIR || '/app/downloads',
              { 
                ...doc,
                resolution,
                filename: `${doc.title}_${resolution}.mp4`.replace(/[<>:"/\\|?*]/g, '_')
              }
            );

            if (downloadResult.success) {
              successfulDownloads++;
              await collection.updateOne(
                { _id: doc._id },
                {
                  $set: {
                    [`aria2Status.${resolution}`]: 'completed',
                    [`aria2DownloadPath.${resolution}`]: downloadResult.filePath,
                    lastUpdated: new Date()
                  }
                }
              );
              console.log(`[Aria2Worker] ${resolution} download completed for ${doc._id}`);
            } else {
              throw new Error(downloadResult.error || 'Download failed');
            }
          } catch (error) {
            console.error(`[Aria2Worker] Download failed for ${resolution}:`, error);
            await collection.updateOne(
              { _id: doc._id },
              {
                $set: {
                  [`aria2Status.${resolution}`]: 'error',
                  [`errors.${resolution}`]: error.message
                }
              }
            );
          }
        }

        // Update final status
        if (successfulDownloads > 0) {
          await collection.updateOne(
            { _id: doc._id },
            {
              $set: {
                processingStatus: PROCESSING_STATUS.READY_FOR_TELEGRAM,
                completedAt: new Date()
              }
            }
          );
        } else if (totalAttempts > 0) {
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
        }

        console.log(`[Aria2Worker] Completed processing ${doc._id} - ${successfulDownloads}/${totalAttempts} successful`);
      }
    });
  }
}

module.exports = Aria2Worker;
