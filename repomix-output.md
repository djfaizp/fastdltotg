This file is a merged representation of the entire codebase, combined into a single document by Repomix. The content has been processed where comments have been removed, empty lines have been removed.

# File Summary

## Purpose
This file contains a packed representation of the entire repository's contents.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.

## File Format
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Multiple file entries, each consisting of:
  a. A header with the file path (## File: path/to/file)
  b. The full contents of the file in a code block

## Usage Guidelines
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Code comments have been removed from supported file types
- Empty lines have been removed from all files

## Additional Info

# Directory Structure
```
.dockerignore
docker-compose.yml
Dockerfile
downloadWorker_changes.md
package.json
src/aria2.js
src/db.js
src/generate_session.js
src/index.js
src/processors.js
src/telegram.js
src/utils.js
src/utils/browser.js
src/workers/aria2Worker.js
src/workers/baseWorker.js
src/workers/downloadWorker.js
src/workers/telegramWorker.js
start.sh
```

# Files

## File: .dockerignore
````
node_modules
*.log
.git
error-screenshot-*.png
.dockerignore
*.md
.repomixignore
repomix.config.json
````

## File: docker-compose.yml
````yaml
services:
  app:
    build: .
    container_name: download-scraper
    restart: unless-stopped
    ports:
      - "1234:1234"
      - "6800:6800"
    volumes:
      - ./downloads:/app/downloads:rw
      - ./chrome-data:/app/chrome-data:rw,z
      - aria2_config:/etc/aria2:rw
    environment:
      - NODE_ENV=production
      - ARIA2_HOST=localhost
      - ARIA2_PORT=6800
      - TELEGRAM_API_ID=${TELEGRAM_API_ID}
      - TELEGRAM_API_HASH=${TELEGRAM_API_HASH}
      - TELEGRAM_STRING_SESSION=${TELEGRAM_STRING_SESSION}
      - TELEGRAM_CHANNEL_ID=${TELEGRAM_CHANNEL_ID}
      - ARIA2_SECRET=${ARIA2_SECRET}
      - MONGO_URI=${MONGO_URI}
      - ARIA2_DOWNLOAD_DIR=/app/downloads
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6800/jsonrpc"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
volumes:
  aria2_config:
````

## File: Dockerfile
````dockerfile
FROM node:23.1.0-slim

# Install dependencies in a single RUN to reduce layers
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    gnupg \
    ca-certificates \
    apt-transport-https \
    chromium \
    chromium-driver \
    xvfb \
    aria2 \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/chromium

WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Combine npm commands and remove npm cache
RUN npm ci --only=production && \
    npm cache clean --force

# Copy application files
COPY . .

# Make start script executable
RUN chmod +x start.sh

EXPOSE 1234 6800

CMD ["./start.sh"]
````

## File: downloadWorker_changes.md
````markdown
# Changes Required for downloadWorker.js

## Replace Puppeteer with Puppeteer-Real-Browser

### 1. Update Imports
Replace:
```javascript
const puppeteer = require('puppeteer');
```

With:
```javascript
const { connect } = require('puppeteer-real-browser');
```

### 2. Modify Browser Initialization
Replace:
```javascript
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
```

With:
```javascript
const connection = await connect({
  headless: false,
  turnstile: true,
  disableXvfb: false,
  defaultViewport: null
});
const browser = connection.browser;
const page = connection.page;
```

### 3. Update Browser Cleanup
Replace:
```javascript
await browser.close();
```

With:
```javascript
await connection.close();
```

### 4. Pass Browser to processUrl
Update the processUrl call to include the browser instance:
```javascript
updates.directUrls[res] = await processUrl(doc[res], doc, res, browser);
```

## Instructions
1. Open src/workers/downloadWorker.js
2. Make the changes as outlined above
3. Save the file
4. Test the changes to ensure proper functionality
````

## File: package.json
````json
{
    "name": "download-scraper",
    "version": "1.0.0",
    "main": "index.js",
    "type": "commonjs",
    "scripts": {
        "start": "node src/index.js"
    },
    "dependencies": {
        "aria2": "^4.1.2",
        "dotenv": "^16.4.7",
        "download-scraper": "file:",
        "mongodb": "^6.3.0",
        "node-cache": "^5.1.2",
        "puppeteer-proxy": "^1.0.3",
        "puppeteer-real-browser": "^1.4.0",
        "repomix": "^0.2.28",
        "telegram": "^2.26.22",
        "uuid": "^11.0.5"
    }
}
````

## File: src/aria2.js
````javascript
const Aria2 = require('aria2');
const path = require('path');
const { getCollection } = require('./db');
const aria2Config = Object.freeze({
    host: 'localhost',
    port: 6800,
    secure: false,
    secret: process.env.ARIA2_SECRET,
    path: '/jsonrpc',
    'max-concurrent-downloads': 3,
    'max-connection-per-server': 10,
    'min-split-size': '10M',
    'split': 10,
    'file-allocation': 'none',
    'async-dns': 'true',
    'enable-http-keep-alive': 'true',
    'enable-http-pipelining': 'true',
    'out': '' // Will be set dynamically
});
const fs = require('fs').promises;
const { createReadStream } = require('fs');
require('dotenv').config();
let aria2Instance = null;
const getAria2Client = async () => {
    if (!aria2Instance) {
        console.log('[Aria2] Creating new aria2 client instance');
        try {
            aria2Instance = new Aria2(aria2Config);
            aria2Instance.on('error', (err) => {
                console.error('❌ Aria2 connection error:', err);
                aria2Instance = null;
            });
            aria2Instance.on('open', () =>
                console.log('✅ Aria2 connection established'));
            aria2Instance.on('close', () =>
                console.warn('⚠️ Aria2 connection closed'));
            await aria2Instance.open();
            await aria2Instance.call('getVersion');
        } catch (err) {
            aria2Instance = null;
            throw err;
        }
    }
    return aria2Instance;
};
const EMOJI_MAP = Object.freeze({
    movie: '🎬',
    file: '📁',
    language: '🗣️',
    originalLanguage: '🌍',
    runtime: '⏱️',
    genres: '🎭'
});
const metadataCache = new Map();
function sanitizeMetadata(doc) {
    const cacheKey = doc._id?.toString();
    if (cacheKey && metadataCache.has(cacheKey)) {
      return metadataCache.get(cacheKey);
    }
    const sanitized = {
      title: String(doc.title || '').trim(),
      language: String(doc.language || doc.Language || '').trim(),
      originalLanguage: String(doc.originalLanguage || doc["Original Language"] || '').trim(),
      runtime: String(doc.runtime || doc.Runtime || '').trim(),
      genres: []
    };
    // Handle genres whether it's stored as an array or a comma-separated string
    if (doc.genres || doc.Genres) {
      const rawGenres = doc.genres || doc.Genres;
      if (Array.isArray(rawGenres)) {
        sanitized.genres = rawGenres.filter(Boolean).map(String);
      } else if (typeof rawGenres === 'string') {
        sanitized.genres = rawGenres.split(',').map(g => g.trim()).filter(Boolean);
      }
    }
    if (cacheKey) {
      metadataCache.set(cacheKey, sanitized);
      setTimeout(() => metadataCache.delete(cacheKey), 300000);
    }
    return sanitized;
  }
const formatMetadata = (doc, resolution) => {
    const sanitized = sanitizeMetadata(doc);
    return {
        Movie: sanitized.title,
        Language: sanitized.language,
        'Original Language': sanitized.originalLanguage,
        Runtime: sanitized.runtime,
        Genres: sanitized.genres.join(', '),
        resolution
    };
};
const formatCaption = (metadata, fileName) => {
    if (!fileName) throw new Error('Filename is required');
    return `${EMOJI_MAP.movie} ${metadata.Movie || 'N/A'}
${EMOJI_MAP.file} ${fileName}
${EMOJI_MAP.language} ${metadata.Language || 'N/A'}
${EMOJI_MAP.originalLanguage} ${metadata['Original Language'] || 'N/A'}
${EMOJI_MAP.runtime} ${metadata.Runtime || 'N/A'}
${EMOJI_MAP.genres} ${metadata.Genres || 'N/A'}`;
};
async function downloadVideo(url, dir = process.env.ARIA2_DOWNLOAD_DIR, metadata = {}) {
    const aria2 = getAria2Client();
    let currentGuid = null;
    let downloadedFilePath = null;
    try {
        const urlObj = new URL(url);
        const originalFilename = path.basename(urlObj.pathname);
        const cleanFilename = originalFilename.split('?')[0];
        const options = {
            ...DEFAULT_DOWNLOAD_OPTIONS,
            dir,
            'out': cleanFilename
        };
        console.log(`📥 Downloading ${cleanFilename} from ${url}`);
        currentGuid = await aria2.call('addUri', [url], options);
        const status = await new Promise((resolve, reject) => {
            let lastUpdate = Date.now();
            const checkStatus = async () => {
                try {
                    const status = await aria2.call('tellStatus', currentGuid);
                    const now = Date.now();
                    if (now - lastUpdate > 1000) {
                        const progress = parseInt(status.completedLength) / parseInt(status.totalLength);
                        process.stdout.write(`\rProgress: ${(progress * 100).toFixed(1)}%`);
                        lastUpdate = now;
                    }
                    if (status.status === 'complete') {
                        console.log(`\n✅ Download completed: ${cleanFilename}`);
                        resolve(status);
                    } else if (status.status === 'error') {
                        reject(new Error(status.errorMessage));
                    } else {
                        setTimeout(checkStatus, 1000);
                    }
                } catch (error) {
                    reject(error);
                }
            };
            checkStatus();
        });
        downloadedFilePath = status.files[0]?.path;
        const { uploadToTelegram } = require('./telegram');
        const caption = formatCaption(metadata, cleanFilename);
        const uploadResult = await uploadToTelegram(downloadedFilePath, caption);
        if (metadata._id && metadata.resolution) {
            const updates = {
                [`uploadedToTelegram.${metadata.resolution}`]: true,
                [`telegramLinks.${metadata.resolution}`]: uploadResult.messageLink,
                lastUpdated: new Date()
            };
            const postsCollection = await getCollection('posts');
            await postsCollection.updateOne(
                { _id: metadata._id },
                { $set: updates },
                { w: 1 }
            );
        }
        return { success: true, ...uploadResult };
    } catch (error) {
        console.error('❌ Download error:', error);
        return { success: false, error: error.message };
    } finally {
        if (currentGuid) {
            await aria2.call('removeDownloadResult', currentGuid).catch(() => {});
        }
    }
}
module.exports = {
    getAria2Client,
    downloadVideo,
    formatCaption,
    formatMetadata,
    EMOJI_MAP
};
````

## File: src/db.js
````javascript
const { MongoClient } = require('mongodb');
const NodeCache = require('node-cache');
require('dotenv').config();
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
const connectionSettings = {
  maxPoolSize: 10,
  minPoolSize: 2,
  connectTimeoutMS: 5000,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 3000,
  retryWrites: true,
  retryReads: true,
  heartbeatFrequencyMS: 10000
};
const client = new MongoClient(process.env.MONGO_URI, connectionSettings);
let dbConnection = null;
let isConnecting = false;
async function createIndexes(db) {
  try {
    const postsCollection = db.collection('posts');
    await postsCollection.createIndex({ processingStatus: 1 });
    await postsCollection.createIndex({ isScraped: 1 });
    await postsCollection.createIndex({ startedAt: -1 });
    console.log('📦 MongoDB indexes created');
  } catch (error) {
    console.error('❌ Failed to create indexes:', error);
  }
}
module.exports = {
  connect: async (mongoDatabaseName) => {
    if (dbConnection) {
      console.log('[MongoDB] Using existing connection');
      return dbConnection;
    }
    console.log('[MongoDB] Establishing new connection...');
    if (isConnecting) {
      console.log('[MongoDB] Waiting for existing connection attempt...');
      while (isConnecting) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return dbConnection;
    }
    try {
      isConnecting = true;
      await client.connect();
      dbConnection = client.db(mongoDatabaseName);
      await createIndexes(dbConnection);
      console.log('📦 Connected to MongoDB (new connection)');
      client.on('serverClosed', (e) => {
        console.log('[MongoDB] Connection closed:', e);
        dbConnection = null;
      });
      client.on('serverOpening', (e) => {
        console.log('[MongoDB] Reconnecting:', e);
      });
      client.on('serverHeartbeatFailed', (e) => {
        console.error('[MongoDB] Heartbeat failed:', e);
      });
      return dbConnection;
    } catch (error) {
      console.error('[MongoDB] Connection failed:', error);
      throw error;
    } finally {
      isConnecting = false;
    }
  },
  getCollection: async (name) => {
    const db = await module.exports.connect(process.env.MONGO_DB);
    return db.collection(name);
  },
  getCachedCollection: async (name) => {
    const cacheKey = `collection_${name}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const collection = await module.exports.getCollection(name);
    cache.set(cacheKey, collection);
    return collection;
  },
  close: async () => {
    if (client) {
      await client.close();
      dbConnection = null;
      console.log('📦 MongoDB connection closed');
    }
  },
  PROCESSING_STATUS: Object.freeze({
    PENDING: 'pending',
    DOWNLOADING: 'downloading',
    READY_FOR_ARIA2: 'ready_for_aria2',
    DOWNLOADING_ARIA2: 'downloading_aria2',
    READY_FOR_TELEGRAM: 'ready_for_telegram',
    UPLOADING_TELEGRAM: 'uploading_telegram',
    COMPLETED: 'completed',
    ERROR: 'error'
  }),
};
````

## File: src/generate_session.js
````javascript
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
require('dotenv').config();
const apiId = process.env.TELEGRAM_API_ID;
const apiHash = process.env.TELEGRAM_API_HASH;
(async () => {
    const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
        connectionRetries: 5,
    });
    await client.start({
        phoneNumber: async () => await input.text('Please enter your phone number: '),
        password: async () => await input.text('Please enter your password: '),
        phoneCode: async () => await input.text('Please enter the code you received: '),
        onError: (err) => console.log(err),
    });
    console.log('Your string session:', client.session.save());
    await client.disconnect();
})();
````

## File: src/index.js
````javascript
const { close } = require('./db');
const DownloadWorker = require('./workers/downloadWorker');
const Aria2Worker = require('./workers/aria2Worker');
const TelegramWorker = require('./workers/telegramWorker');
const { delay } = require('./utils');
const { getAria2Client } = require('./aria2');
const maxDownloadWorkers = parseInt(process.env.MAX_DOWNLOAD_WORKERS) || 1;
const maxAria2Workers = parseInt(process.env.MAX_ARIA2_WORKERS) || 1;
const maxTelegramWorkers = parseInt(process.env.MAX_TELEGRAM_WORKERS) || 1;
console.log(`Worker configuration:
  MAX_DOWNLOAD_WORKERS=${maxDownloadWorkers}
  MAX_ARIA2_WORKERS=${maxAria2Workers}
  MAX_TELEGRAM_WORKERS=${maxTelegramWorkers}`);
async function checkAria2Connection() {
  try {
    const aria2 = await getAria2Client();
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
    const startWorkers = [
      ...downloadWorkers.map(w => w.start().catch(e => console.error('Download worker failed to start:', e))),
      ...aria2Workers.map(w => w.start().catch(e => console.error('Aria2 worker failed to start:', e))),
      ...telegramWorkers.map(w => w.start().catch(e => console.error('Telegram worker failed to start:', e)))
    ];
    await Promise.all(startWorkers);
    console.log('✅ All workers running');
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
process.on('unhandledRejection', (error) => {
  if (error.code === 'EPERM') {
    console.warn('Permission error (likely temporary file cleanup):', error.message);
  } else {
    console.error('Unhandled rejection:', error);
  }
});
main().catch(error => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
````

## File: src/processors.js
````javascript
const { downloadVideo } = require('./aria2');
const { delay, getFileSize, waitRandom } = require('./utils');
const browserManager = require('./utils/browser');
async function processUrl(url, doc, resolution) {
    const maxRetries = 2;
    let browserInstance;
    try {
      console.log(`[Processors] Creating browser instance...`);
      browserInstance = await browserManager.createBrowserInstance();
      const page = browserInstance.page;
      console.log(`[Processors] Configuring page...`);
      await browserManager.configurePage(page);
      console.log(`[Processors] Navigating to URL: ${url}`);
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 120000
      });
      console.log(`[Processors] Waiting for Cloudflare Turnstile captcha to be solved...`);
      await page.waitForFunction(() => {
        const input = document.querySelector('input[name="cf-turnstile-response"]');
        return input?.value?.trim().length > 30;
      }, {
        timeout: 600000,
        polling: 'raf'
      });
      console.log(`[Processors] Captcha solved, waiting a random period before download...`);
      await waitRandom(1000, 3000);
      console.log(`[Processors] Looking for download frame...`);
      let targetFrame = null;
      const frames = await page.frames();
      for (const frame of frames) {
        try {
          const hasButton = await frame.evaluate(() => {
            const btn = document.querySelector('#download-button');
            return btn && btn.offsetParent !== null;
          });
          if (hasButton) {
            targetFrame = frame;
            break;
          }
        } catch (err) {
          continue;
        }
      }
      if (!targetFrame) {
        throw new Error('Download frame not found');
      }
      await targetFrame.waitForSelector('#download-button', {
        visible: true,
        timeout: 15000
      });
      console.log(`[Processors] Found download frame, clicking download button...`);
      await Promise.all([
        page.waitForNavigation({
          waitUntil: 'domcontentloaded',
          timeout: 60000
        }),
        targetFrame.click('#download-button')
      ]);
      console.log(`[Processors] Waiting for direct URL to become available...`);
      await page.waitForFunction(() => {
        const el = document.querySelector('#vd');
        return el?.href?.length > 100;
      }, { timeout: 120000, polling: 'raf' });
      const videoUrl = await page.$eval('#vd', el => el.href);
      console.log(`[Processors] Successfully retrieved direct URL: ${videoUrl}`);
      return videoUrl;
    } catch (error) {
      console.error('[Processors] Processing error:', error);
      throw error;
    } finally {
      if (browserInstance) {
        await browserManager.closeBrowserInstance(browserInstance).catch(console.error);
      }
    }
  }
module.exports = {
    processUrl
};
````

## File: src/telegram.js
````javascript
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const path = require('path');
require('dotenv').config();
const apiId = process.env.TELEGRAM_API_ID;
const apiHash = process.env.TELEGRAM_API_HASH;
const stringSession = new StringSession(process.env.TELEGRAM_STRING_SESSION);
const channelId = process.env.TELEGRAM_CHANNEL_ID;
let client = null;
async function initializeClient() {
    if (!client) {
        if (!apiId || !apiHash || !stringSession || !channelId) {
            throw new Error('Missing required Telegram credentials in environment variables');
        }
        client = new TelegramClient(stringSession, parseInt(apiId), apiHash, {
            connectionRetries: 10,
            maxConcurrentDownloads: 8,
            useWSS: true,
            requestRetries: 3,
            downloadRetries: 3,
            uploadRetries: 3,
            retryDelay: 1000,
            workers: 8,
            maxUploadParts: 4000,
            dcId: 2,
            useIPV6: false,
            timeout: 30000
        });
        await client.connect();
        const me = await client.getMe();
        console.log('Connected to Telegram as:', me.username);
    }
    return client;
}
async function uploadToTelegram(filePath, caption = '') {
    try {
        console.log('🚀 Initializing client...');
        const client = await initializeClient();
        // Check API connectivity
        console.log('🔗 Checking Telegram API connectivity...');
        const me = await client.getMe();
        console.log('✅ API connectivity verified as:', me.username);
        // Validate file existence
        const fs = require('fs');
        if (!fs.existsSync(filePath)) {
            console.error(`❌ File not found: ${filePath}`);
            throw new Error(`File not found: ${filePath}`);
        }
        const stats = fs.statSync(filePath);
        const fileSize = stats.size;
        const fileSizeInMB = fileSize / (1024 * 1024);
        if (fileSizeInMB > 2048) {
            throw new Error(`❌ File size (${fileSizeInMB.toFixed(2)}MB) exceeds Telegram's 2GB limit`);
        }
        console.log(`📤 Preparing to upload ${path.basename(filePath)} (${fileSizeInMB.toFixed(2)}MB) to Telegram...`);
        if (!channelId.startsWith('-100')) {
            console.error('❌ Invalid channelId. It must start with -100.');
            throw new Error('Invalid channelId. Ensure it starts with -100.');
        }
        let lastProgress = 0;
        let lastProgressUpdate = Date.now();
        const PROGRESS_UPDATE_INTERVAL = 1000;
        const result = await client.sendFile(channelId, {
            file: filePath,
            caption: caption,
            progressCallback: (progress) => {
                const now = Date.now();
                if (typeof progress === 'number' && progress >= 0 && progress <= 1) {
                    const currentProgress = Math.floor(progress * 100);
                    const uploadedBytes = Math.floor(fileSize * progress);
                    const uploadedMB = (uploadedBytes / (1024 * 1024)).toFixed(2);
                    console.log(`⬆️ Upload progress: ${currentProgress}% (${uploadedMB}MB/${fileSizeInMB.toFixed(2)}MB)`);
                    if (currentProgress >= lastProgress + 5 && now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
                        lastProgress = currentProgress;
                        lastProgressUpdate = now;
                    }
                }
            },
            workers: 8,
            forceDocument: true,
            partSize: 1024 * 1024,
            noWait: true,
            attributes: [
                new Api.DocumentAttributeFilename({
                    fileName: path.basename(filePath)
                })
            ]
        });
        const messageLink = `https://t.me/c/${channelId.toString().replace('-100', '')}/${result.id}`;
        console.log('✅ File uploaded successfully to Telegram');
        console.log('📎 Message link:', messageLink);
        return {
            success: true,
            messageId: result.id,
            messageLink: messageLink,
            fileSize: fileSizeInMB,
            fileName: path.basename(filePath)
        };
    } catch (error) {
        console.error('❌ Telegram upload error:', error);
        if (error.message.includes('FLOOD_WAIT_')) {
            const seconds = parseInt(error.message.match(/FLOOD_WAIT_(\d+)/)[1]);
            console.warn(`⏳ Flood wait error. Retrying in ${seconds} seconds...`);
            await new Promise(res => setTimeout(res, seconds * 1000));
            return uploadToTelegram(filePath, caption);
        }
        throw error;
    }
}
async function closeClient() {
    if (client) {
        try {
            await client.disconnect();
            client = null;
            console.log('Telegram client disconnected');
        } catch (error) {
            console.error('Error disconnecting Telegram client:', error);
        }
    }
}
process.on('SIGINT', async () => {
    console.log('Received SIGINT. Closing Telegram client...');
    await closeClient();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    console.log('Received SIGTERM. Closing Telegram client...');
    await closeClient();
    process.exit(0);
});
module.exports = { uploadToTelegram, closeClient };
````

## File: src/utils.js
````javascript
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const TEMP_DIR = path.join(os.tmpdir(), 'download-worker-temp');
async function ensureTempDir() {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}
async function safeWrite(filePath, content) {
  await ensureTempDir();
  const tempPath = path.join(TEMP_DIR, uuidv4());
  try {
    await fs.writeFile(tempPath, content);
    await fs.rename(tempPath, filePath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch (cleanupError) {
      logger.error('Failed to clean up temp file:', cleanupError);
    }
    throw error;
  }
}
async function safeDelete(filePath, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      await fs.unlink(filePath);
      return;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(r => setTimeout(r, 100 * (2 ** i)));
    }
  }
}
async function cleanupTempDirs() {
  try {
    const files = await fs.readdir(TEMP_DIR);
    await Promise.all(
      files.map(file =>
        fs.rm(path.join(TEMP_DIR, file), { recursive: true, force: true })
      )
    );
  } catch (error) {
    logger.error('Failed to cleanup temp directories:', error);
  }
}
const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args)
};
module.exports = {
  logger,
  delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  waitRandom: (min, max) => {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
  },
  getFileSize: function(url) {
    const https = require('https');
    return new Promise((resolve, reject) => {
      console.log('🔍 Checking file size for URL:', url);
      const request = https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          console.log('🔄 Following redirect to:', response.headers.location);
          return this.getFileSize(response.headers.location)
            .then(resolve)
            .catch(reject);
        }
        const contentLength = response.headers['content-length'];
        resolve(contentLength ? parseInt(contentLength, 10) : null);
      });
      request.on('error', reject);
      request.setTimeout(120000, () => {
        request.destroy();
        resolve(null);
      });
    });
  },
  formatSpeed: (bytesPerSecond) => {
    const units = ["B/s", "KB/s", "MB/s", "GB/s"];
    let speed = bytesPerSecond;
    let unitIndex = 0;
    while (speed >= 1024 && unitIndex < units.length - 1) {
      speed /= 1024;
      unitIndex++;
    }
    return `${speed.toFixed(1)} ${units[unitIndex]}`;
  },
  withRetry: async (fn, retries = 3, delayMs = 1000) => {
    try {
      return await fn();
    } catch (error) {
      if (retries <= 0) throw error;
      await this.delay(delayMs);
      return this.withRetry(fn, retries - 1, delayMs * 2);
    }
  },
  sanitizeMetadata: (doc) => ({
    title: String(doc.title || "").trim(),
    language: String(doc.language || "").trim(),
    originalLanguage: String(doc.originalLanguage || "").trim(),
    runtime: String(doc.runtime || "").trim(),
    genres: Array.isArray(doc.genres) ?
      doc.genres.filter(Boolean).map(String) :
      []
  }),
  safeWrite,
  safeDelete,
  cleanupTempDirs
};
````

## File: src/utils/browser.js
````javascript
const { connect } = require('puppeteer-real-browser');
const fs = require('fs');
const os = require('os');
const path = require('path');
class BrowserManager {
  constructor() {
    this.defaultConfig = {
      headless: false,
      turnstile: true,
      disableXvfb: false,
      defaultViewport: null,
    };
    this.pool = [];
    this.maxInstances = 3;
  }
  async createBrowserInstance() {
    const tempDir = path.join(os.tmpdir(), `chrome-data-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const connection = await connect(this.defaultConfig);
    return {
      browser: connection.browser,
      page: connection.page,
      tempDir
    };
  }
  async closeBrowserInstance(browserInstance) {
    try {
      if (browserInstance.browser) {
        await browserInstance.browser.close();
      }
      if (browserInstance.tempDir) {
        fs.rmSync(browserInstance.tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.error('Error closing browser instance:', error);
    }
  }
  async configurePage(page) {
    await page.setDefaultNavigationTimeout(0);
    await page.setDefaultTimeout(120000);
    await page.setJavaScriptEnabled(true);
    await page.setBypassCSP(true);
    page.on('popup', async popup => {
      const popupUrl = popup.url();
      if (!popupUrl.includes('download') && !popupUrl.includes('cloudflare')) {
        console.log(`Blocked non-essential popup: ${popupUrl}`);
        await popup.close();
      }
    });
    await page.evaluateOnNewDocument(() => {
      window.open = function() {};
      window.alert = function() {};
      window.confirm = function() { return true; };
      window.prompt = function() { return null; };
      Event.prototype.stopPropagation = function() {};
    });
  }
  async getBrowserInstance() {
    if (this.pool.length < this.maxInstances) {
      const instance = await this.createBrowserInstance();
      this.pool.push(instance);
      return instance;
    }
    return this.pool[Math.floor(Math.random() * this.pool.length)];
  }
  async cleanup() {
    await Promise.all(this.pool.map(instance => this.closeBrowserInstance(instance)));
    this.pool = [];
  }
}
module.exports = new BrowserManager();
````

## File: src/workers/aria2Worker.js
````javascript
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
        directUrls: { $exists: true, $ne: {} },
        'aria2Status': 'pending',
        'telegramStatus': { $in: [null, undefined] }
      },
      initialStatusUpdate: {
        $set: {
          processingStatus: PROCESSING_STATUS.DOWNLOADING_ARIA2,
          aria2Status: 'processing',
          startedAt: new Date()
        }
      },
      processDocument: async (doc, collection) => {
        console.log(`[Aria2Worker] Processing document ${doc._id}`);
        let successfulDownloads = 0;
        let totalAttempts = 0;
        for (const [resolution, url] of Object.entries(doc.directUrls)) {
          console.log(`[Aria2Worker] Starting download for ${resolution} from ${url}`);
          if (!url) {
            console.error(`[Aria2Worker] Skipping ${resolution} - URL is missing`);
            continue;
          }
          if (doc.uploadedToTelegram?.[resolution]) {
            console.warn(`[Aria2Worker] Skipping ${resolution} - already uploaded to Telegram`);
            continue;
          }
          totalAttempts++;
          try {
            const downloadResult = await downloadVideo(
              url,
              process.env.ARIA2_DOWNLOAD_DIR,
              { ...doc, resolution }
            );
            if (downloadResult.success) {
              successfulDownloads++;
              await collection.updateOne(
                { _id: doc._id },
                {
                  $set: {
                    [`uploadedToTelegram.${resolution}`]: true,
                    processingStatus: PROCESSING_STATUS.READY_FOR_TELEGRAM,
                    [`aria2Status.${resolution}`]: 'completed',
                    [`completedAt.${resolution}`]: new Date()
                  }
                }
              );
              console.log(`[Aria2Worker] ${resolution} download completed for ${doc._id}`);
            } else {
              throw new Error(`Download failed: ${downloadResult.error}`);
            }
          } catch (error) {
            console.error(`[Aria2Worker] Download failed for ${resolution}. Removing direct URL. Error:`, error);
            await collection.updateOne(
              { _id: doc._id },
              {
                $unset: { [`directUrls.${resolution}`]: "" },
                $set: { [`aria2Status.${resolution}`]: 'failed' }
              }
            );
          }
        }
        if (totalAttempts === 0) {
          await collection.updateOne(
            { _id: doc._id },
            {
              $set: {
                processingStatus: PROCESSING_STATUS.ERROR,
                error: 'No valid URLs to process',
                completedAt: new Date()
              }
            }
          );
        } else if (successfulDownloads === 0) {
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
        } else if (successfulDownloads < totalAttempts) {
          console.log(`[Aria2Worker] Partial success: ${successfulDownloads}/${totalAttempts} downloads completed`);
        }
      }
    });
  }
}
module.exports = Aria2Worker;
````

## File: src/workers/baseWorker.js
````javascript
const { getCollection } = require('../db');
const { PROCESSING_STATUS } = require('../db');
const { delay } = require('../utils.js');
class BaseWorker {
  constructor(collectionName, workerConfig) {
    this.collectionName = collectionName;
    this.config = workerConfig;
    this.shouldRun = true;
    this.activeDocumentId = null;
    this.workerId = Math.random().toString(36).substr(2, 9);
  }
  async initialize() {
    this.collection = await getCollection(this.collectionName);
  }
  async start() {
    await this.initialize();
    console.log(`[${this.config.workerName}:${this.workerId}] Starting worker`);
    while (this.shouldRun) {
      let doc;
      try {
        console.log(`[${this.config.workerName}:${this.workerId}] Polling for documents...`);
        doc = await this.findNextDocument();
        if (!doc) {
          console.log(
            `[${this.config.workerName}:${this.workerId}] No documents found. Retrying in ${this.config.pollingInterval}ms`
          );
          await delay(this.config.pollingInterval);
          continue;
        }
        this.activeDocumentId = doc._id;
        console.log(`[${this.config.workerName}:${this.workerId}] Processing document ${doc._id}`);
        await this.config.processDocument(doc, this.collection);
        console.log(`[${this.config.workerName}:${this.workerId}] Completed processing document ${doc._id}`);
      } catch (error) {
        console.error(`[${this.config.workerName}:${this.workerId}] Error in worker loop:`, error);
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
````

## File: src/workers/downloadWorker.js
````javascript
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
        $and: [
          { processingStatus: { $in: [PROCESSING_STATUS.PENDING, null] } },
          { 'aria2Status': { $exists: false } },
          { 'telegramStatus': { $exists: false } }
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
        let browserInstance;
        let successfulUrls = 0;
        let totalAttempts = 0;
        const updates = { directUrls: {} };
        try {
          browserInstance = await browserManager.createBrowserInstance();
          for (const resolution of ['480p', '720p', '1080p']) {
            if (!doc[resolution]) continue;
            totalAttempts++;
            let retries = 3;
            let succeeded = false;
            while (retries > 0 && !succeeded) {
              try {
                const directUrl = await processUrl(doc[resolution], doc, resolution);
                if (directUrl) {
                  updates.directUrls[resolution] = directUrl;
                  succeeded = true;
                  successfulUrls++;
                  logger.info(`[DownloadWorker] Got direct URL for ${resolution}: ${directUrl}`);
                  await collection.updateOne(
                    { _id: doc._id },
                    {
                      $set: {
                        [`directUrls.${resolution}`]: directUrl,
                        [`processingStatus.${resolution}`]: PROCESSING_STATUS.READY_FOR_ARIA2,
                        [`lastUpdated.${resolution}`]: new Date()
                      }
                    }
                  );
                }
                break;
              } catch (error) {
                retries--;
                if (retries === 0) {
                  logger.error(`[DownloadWorker] Failed to get direct URL for ${resolution} after all retries`);
                  await collection.updateOne(
                    { _id: doc._id },
                    {
                      $set: {
                        [`processingStatus.${resolution}`]: PROCESSING_STATUS.ERROR,
                        [`error.${resolution}`]: error.message,
                        [`lastUpdated.${resolution}`]: new Date()
                      }
                    }
                  );
                } else {
                  logger.warn(`[DownloadWorker] Retrying ${resolution} for ${doc._id}, ${retries} attempts remaining`);
                  await new Promise(resolve => setTimeout(resolve, 1000));
                }
              }
            }
          }
          if (totalAttempts === 0) {
            await collection.updateOne(
              { _id: doc._id },
              {
                $set: {
                  processingStatus: PROCESSING_STATUS.ERROR,
                  error: 'No resolutions to process',
                  completedAt: new Date()
                }
              }
            );
          } else if (successfulUrls === 0) {
            await collection.updateOne(
              { _id: doc._id },
              {
                $set: {
                  processingStatus: PROCESSING_STATUS.ERROR,
                  error: 'Failed to get any direct URLs',
                  completedAt: new Date()
                }
              }
            );
          } else {
            await collection.updateOne(
              { _id: doc._id },
              {
                $set: {
                  processingStatus: PROCESSING_STATUS.READY_FOR_ARIA2,
                  aria2Status: 'pending',
                  completedAt: new Date(),
                  partialSuccess: successfulUrls < totalAttempts
                }
              }
            );
            logger.info(
              `[DownloadWorker] Updated document ${doc._id} with ${successfulUrls}/${totalAttempts} direct URLs`
            );
          }
        } catch (error) {
          logger.error(`[DownloadWorker] Unexpected error processing ${doc._id}:`, error);
          await collection.updateOne(
            { _id: doc._id },
            {
              $set: {
                processingStatus: PROCESSING_STATUS.ERROR,
                error: error.message,
                completedAt: new Date()
              }
            }
          );
        } finally {
          if (browserInstance) {
            await browserManager.closeBrowserInstance(browserInstance).catch(err =>
              logger.error('[DownloadWorker] Error closing browser:', err)
            );
          }
        }
      }
    });
  }
}
module.exports = DownloadWorker;
````

## File: src/workers/telegramWorker.js
````javascript
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
        uploadedToTelegram: { $exists: true },
        telegramLinks: { $not: { $size: 3 } },
        'aria2Status': 'completed',
        'telegramStatus': { $ne: 'completed' }
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
          for (const resolution of ['480p', '720p', '1080p']) {
            console.log(`[TelegramWorker] Checking ${resolution} for upload`);
            if (!doc.directUrls?.[resolution] || doc.telegramLinks?.[resolution]) continue;
            const filePath = path.join(
              process.env.ARIA2_DOWNLOAD_DIR,
              path.basename(doc.directUrls[resolution])
            );
            filesToDelete.push(filePath);
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
          }
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
````

## File: start.sh
````bash
pkill aria2c || true
mkdir -p /app/logs /etc/aria2 /app/downloads
chmod -R 755 /app /etc/aria2 /app/downloads
cat > /etc/aria2/aria2.conf << EOF
dir=/app/downloads
disable-ipv6=true
enable-rpc=true
rpc-listen-port=6800
rpc-listen-all=false
rpc-allow-origin-all=true
rpc-secret=${ARIA2_SECRET}
continue=true
max-concurrent-downloads=3
max-connection-per-server=10
min-split-size=10M
split=10
EOF
echo "Starting aria2c..."
aria2c --conf-path=/etc/aria2/aria2.conf \
       --log=/app/logs/aria2c.log \
       --log-level=info &
echo "Waiting for aria2c to start..."
sleep 5
if ! pgrep aria2c > /dev/null; then
    echo "Error: aria2c failed to start"
    cat /app/logs/aria2c.log
    exit 1
fi
curl -s "http://127.0.0.1:6800/jsonrpc" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"aria2.getVersion","id":"test","params":["token:'${ARIA2_SECRET}'"]}' || {
    echo "Error: aria2c RPC test failed"
    exit 1
}
echo "aria2c started successfully"
echo "Starting Node.js application..."
exec node src/index.js
````
