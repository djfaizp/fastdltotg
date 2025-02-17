const { close } = require('./db');
const DownloadWorker = require('./workers/downloadWorker');
const Aria2Worker = require('./workers/aria2Worker');
const TelegramWorker = require('./workers/telegramWorker');
const { delay } = require('./utils');

// Get worker limits from environment variables
const maxDownloadWorkers = parseInt(process.env.MAX_DOWNLOAD_WORKERS) || 1;
const maxAria2Workers = parseInt(process.env.MAX_ARIA2_WORKERS) || 1;
const maxTelegramWorkers = parseInt(process.env.MAX_TELEGRAM_WORKERS) || 1;

async function main() {
  try {
    console.log('🚀 Initializing workers...');
    
    // Initialize worker arrays
    const downloadWorkers = Array.from({ length: maxDownloadWorkers }, () => new DownloadWorker());
    const aria2Workers = Array.from({ length: maxAria2Workers }, () => new Aria2Worker());
    const telegramWorkers = Array.from({ length: maxTelegramWorkers }, () => new TelegramWorker());

    // Start workers with staggered delays
    console.log(`Starting ${maxDownloadWorkers} download workers...`);
    for (const worker of downloadWorkers) {
      await worker.start();
      await delay(1000);
    }

    // Make sure aria2 is running before starting aria2 workers
    console.log('Waiting for aria2 RPC to be ready...');
    await delay(2000); // Give aria2 time to start

    console.log(`Starting ${maxAria2Workers} aria2 workers...`);
    for (const worker of aria2Workers) {
      await worker.start();
      await delay(1000);
    }

    console.log(`Starting ${maxTelegramWorkers} telegram workers...`);
    for (const worker of telegramWorkers) {
      await worker.start();
      await delay(1000);
    }

    console.log('✅ All workers running');

    // Keep the process running
    process.on('SIGINT', async () => {
      console.log('Shutting down workers...');
      await close();
      process.exit(0);
    });
  } catch (error) {
    console.error('🔥 Critical error:', error);
    await close();
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

main().catch(console.error);
