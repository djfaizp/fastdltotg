const { close } = require('./db');
const DownloadWorker = require('./workers/downloadWorker');
const Aria2Worker = require('./workers/aria2Worker');
const TelegramWorker = require('./workers/telegramWorker');
const { delay } = require('./utils');
const { getAria2Client } = require('./aria2');
// Get worker limits from environment variables
const maxDownloadWorkers = parseInt(process.env.MAX_DOWNLOAD_WORKERS) || 1;
const maxAria2Workers = parseInt(process.env.MAX_ARIA2_WORKERS) || 1;
const maxTelegramWorkers = parseInt(process.env.MAX_TELEGRAM_WORKERS) || 1;

console.log(`Worker configuration:
  MAX_DOWNLOAD_WORKERS=${maxDownloadWorkers}
  MAX_ARIA2_WORKERS=${maxAria2Workers}
  MAX_TELEGRAM_WORKERS=${maxTelegramWorkers}`);

async function checkAria2Connection() {
  try {
    const aria2 = await getAria2Client(); // Add await here
    await aria2.call('getVersion');
    console.log('✅ Aria2 RPC connection successful');
    return true;
  } catch (error) {
    console.error('❌ Aria2 RPC connection failed:', error.message);
    return false;
  }
}

async function main() {
  try {
    console.log('🚀 Initializing workers...');
    
    // Check aria2 connection with retries first
    console.log('Waiting for aria2 RPC to be ready...');
    let aria2Ready = false;
    for (let i = 0; i < 5; i++) {
      aria2Ready = await checkAria2Connection();
      if (aria2Ready) break;
      console.log(`Retrying aria2 connection in 2 seconds... (attempt ${i + 1}/5)`);
      await delay(2000);
    }

    if (!aria2Ready) {
      throw new Error('Failed to connect to aria2 RPC after 5 attempts');
    }

    // Initialize all worker instances
    const downloadWorkers = Array.from(
      { length: maxDownloadWorkers }, 
      () => new DownloadWorker()
    );
    
    const aria2Workers = Array.from(
      { length: maxAria2Workers }, 
      () => new Aria2Worker()
    );
    
    const telegramWorkers = Array.from(
      { length: maxTelegramWorkers }, 
      () => new TelegramWorker()
    );

    // Start all workers concurrently
    const startWorkers = [
      ...downloadWorkers.map(w => w.start().catch(e => console.error('Download worker failed to start:', e))),
      ...aria2Workers.map(w => w.start().catch(e => console.error('Aria2 worker failed to start:', e))),
      ...telegramWorkers.map(w => w.start().catch(e => console.error('Telegram worker failed to start:', e)))
    ];

    // Wait for all workers to initialize (but not block on their infinite loops)
    await Promise.all(startWorkers);
    
    console.log('✅ All workers running');

    // Keep the process running and handle shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down workers...');
      
      const allWorkers = [...downloadWorkers, ...aria2Workers, ...telegramWorkers];
      await Promise.all(allWorkers.map(worker => worker.stop()));
      
      await close();
      process.exit(0);
    });

  } catch (error) {
    console.error('🔥 Critical error:', error);
    await close();
    process.exit(1);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  if (error.code === 'EPERM') {
    console.warn('Permission error (likely temporary file cleanup):', error.message);
  } else {
    console.error('Unhandled rejection:', error);
  }
});

// Start the application
main().catch(error => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
