const { connect } = require("puppeteer-real-browser");
const fs = require('fs');
const { close } = require('./db');
const { processUrl } = require('./processors');
const { downloadVideo, formatMetadata } = require('./aria2');
const DownloadWorker = require('./workers/downloadWorker');
const Aria2Worker = require('./workers/aria2Worker');
const TelegramWorker = require('./workers/telegramWorker');
const { delay } = require('./utils');

function waitRandom(min, max) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
}

async function main() {
  try {
    console.log('🚀 Initializing workers...');
    const workers = {
      download: new DownloadWorker(),
      aria2: new Aria2Worker(),
      telegram: new TelegramWorker()
    };

    // Staggered startup sequence
    await workers.download.start();
    await delay(2000);
    await workers.aria2.start();
    await delay(2000);
    await workers.telegram.start();

    console.log('✅ All workers running');
  } catch (error) {
    console.error('🔥 Critical error:', error);
    process.exit(1);
  }
}

main().catch(console.error);
