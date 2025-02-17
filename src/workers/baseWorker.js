const { getCollection } = require('../db');
const { PROCESSING_STATUS } = require('../db');
const { delay } = require('../utils.js');

class BaseWorker {
  constructor(collectionName, workerConfig) {
    this.collectionName = collectionName;
    this.config = workerConfig;
    this.shouldRun = true;
    this.activeDocumentId = null;
  }

  async initialize() {
    this.collection = await getCollection(this.collectionName);
  }

  async start() {
    await this.initialize();
    console.log(`[${this.config.workerName}] Starting worker`);
    while (this.shouldRun) {
      let doc; // Declare doc outside the try block for wider scope
      try {
        console.log(`[${this.config.workerName}] Polling for documents...`);
        doc = await this.findNextDocument();
        if (!doc) {
          console.log(
            `[${this.config.workerName}] No documents found. Retrying in ${this.config.pollingInterval}ms`
          );
          await delay(this.config.pollingInterval);
          continue;
        }
  
        this.activeDocumentId = doc._id;
        console.log(`[${this.config.workerName}] Processing document ${doc._id}`);
        await this.config.processDocument(doc, this.collection);
        console.log(`[${this.config.workerName}] Completed processing document ${doc._id}`);
      } catch (error) {
        console.error(`[${this.config.workerName}] Error in worker loop:`, error);
        if (doc) await this.handleError(doc._id, error);
        await delay(this.config.errorRetryDelay);
      } finally {
        this.activeDocumentId = null;
      }
    }
  }
  
  async stop() {
    console.log(`[${this.config.workerName}] Stopping worker...`);
    this.shouldRun = false;
    
    // Wait for current document to finish
    while (this.activeDocumentId) {
      console.log(`[${this.config.workerName}] Waiting for current document ${this.activeDocumentId} to finish...`);
      await delay(1000);
    }
  }

  async findNextDocument() {
    return this.collection.findOneAndUpdate(
      this.config.documentFilter,
      this.config.initialStatusUpdate,
      { returnDocument: 'after' }
    );
  }

  async handleError(docId, error) {
    console.error(`[${this.config.workerName}] Error processing ${docId}:`, error);
    try {
      await this.collection.updateOne(
        { _id: docId },
        {
          $set: {
            processingStatus: PROCESSING_STATUS.ERROR,
            error: error.message,
            lastErrorAt: new Date()
          },
          $inc: { errorCount: 1 }
        }
      );

      // If error count exceeds threshold, reset to pending
      const doc = await this.collection.findOne({ _id: docId });
      if (doc.errorCount && doc.errorCount >= 3) {
        await this.collection.updateOne(
          { _id: docId },
          {
            $set: {
              processingStatus: PROCESSING_STATUS.PENDING,
              error: null,
              lastErrorAt: null,
              errorCount: 0
            }
          }
        );
        console.log(`[${this.config.workerName}] Reset document ${docId} to pending after multiple failures`);
      }
    } catch (updateError) {
      console.error(`[${this.config.workerName}] Failed to update error status for ${docId}:`, updateError);
    }
  }
}

module.exports = BaseWorker;
