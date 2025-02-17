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
package.json
src/aria2.js
src/db.js
src/generate_session.js
src/index.js
src/processors.js
src/telegram.js
src/utils.js
src/workers/aria2Worker.js
src/workers/baseWorker.js
src/workers/downloadWorker.js
src/workers/telegramWorker.js
```

# Files

## File: .dockerignore
```
node_modules
*.log
.git
error-screenshot-*.png
.dockerignore
*.md
.repomixignore
repomix.config.json
```

## File: docker-compose.yml
```yaml
services:
  app:
    build: .
    container_name: download-scraper
    restart: unless-stopped
    ports:
      - "1234:1234"
    volumes:
      - ./downloads:/aria2/data
      - ./chrome-data:/app/chrome-data:rw,z
    environment:
      - NODE_ENV=production
      - ARIA2_HOST=aria2
      - ARIA2_PORT=6800
      - TELEGRAM_API_ID=${TELEGRAM_API_ID}
      - TELEGRAM_API_HASH=${TELEGRAM_API_HASH}
      - TELEGRAM_STRING_SESSION=${TELEGRAM_STRING_SESSION}
      - TELEGRAM_CHANNEL_ID=${TELEGRAM_CHANNEL_ID}
      - ARIA2_SECRET=${ARIA2_SECRET}
      - MONGO_URI=${MONGO_URI}
      - ARIA2_DOWNLOAD_DIR=/aria2/data
    user: "1000:1000"
    depends_on:
      - aria2
  aria2:
    image: p3terx/aria2-pro:latest
    container_name: aria2
    ports:
      - "6800:6800"
      - "6888:6888"
      - "6888:6888/udp"
    environment:
      - PUID=1000
      - PGID=1000
      - RPC_SECRET=P3TERX
      - RPC_PORT=6800
    volumes:
      - ./downloads:/aria2/data
      - aria2_config:/config
    restart: unless-stopped
volumes:
  aria2_config:
```

## File: Dockerfile
```dockerfile
FROM node:latest

RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    apt-transport-https \
    chromium \
    chromium-driver \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./

RUN npm update
RUN npm install
RUN npm i -g pm2
COPY . .

EXPOSE 1234

CMD ["pm2-runtime", "src/index.js"]
```

## File: package.json
```json
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
        "puppeteer-real-browser": "^1.4.0",
        "repomix": "^0.2.28",
        "telegram": "^2.26.22"
    }
}
```

## File: src/aria2.js
```javascript
const Aria2 = require('aria2');
const path = require('path');
const { getCollection } = require('./db');
const fs = require('fs').promises;
const { createReadStream } = require('fs');
require('dotenv').config();
const secret = process.env.ARIA2_SECRET;
console.log('🔐 Initializing Aria2 client with host:', process.env.ARIA2_HOST, 'port:', process.env.ARIA2_PORT);
if (!secret) {
    console.warn('⚠️ ARIA2_SECRET environment variable is not set!');
}
const aria2Config = {
    host: "aria2",
    port: 6800,
    secure: false,
    secret: process.env.ARIA2_SECRET,
    path: '/jsonrpc',
    maxRetries: 3,
    retry: true,
    retryInterval: 1000,
    timeout: 30000,
    keepalive: true
};
let aria2Instance = null;
const getAria2Client = () => {
    if (!aria2Instance) {
      aria2Instance = new Aria2(aria2Config);
      aria2Instance.on('error', (err) => {
        console.error('❌ Aria2 connection error:', err);
        aria2Instance = null;
      });
      aria2Instance.on('open', () =>
        console.log('✅ Aria2 connection established'));
      aria2Instance.on('close', () =>
        console.warn('⚠️ Aria2 connection closed'));
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
const DEFAULT_DOWNLOAD_OPTIONS = Object.freeze({
    split: '16',
    'max-connection-per-server': '16',
    'continue': true,
    'allow-overwrite': 'true',
    'auto-file-renaming': 'false',
    'piece-length': '1M',
    'lowest-speed-limit': '1K',
    'max-tries': '5',
    'retry-wait': '10',
    timeout: '600',
    'connect-timeout': '60',
    'max-file-not-found': '5',
    'stream-piece-selector': 'geom',
    'disk-cache': '64M',
    'file-allocation': 'none',
    'async-dns': 'true',
    'enable-http-keep-alive': 'true',
    'enable-http-pipelining': 'true'
});
async function downloadVideo(url, dir = process.env.ARIA2_DOWNLOAD_DIR, metadata = {}) {
    const aria2 = getAria2Client();
    let currentGuid = null;
    let downloadedFilePath = null;
    try {
        const options = Object.assign({}, DEFAULT_DOWNLOAD_OPTIONS, { dir });
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
        const caption = formatCaption(metadata, path.basename(downloadedFilePath));
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
        console.error('Download error:', error);
        return { success: false, error: error.message };
    } finally {
        if (downloadedFilePath) {
            await fs.unlink(downloadedFilePath).catch(() => {});
        }
        if (currentGuid) {
            await aria2.call('removeDownloadResult', currentGuid).catch(() => {});
        }
    }
}
module.exports = {
    downloadVideo,
    formatCaption,
    formatMetadata,
    EMOJI_MAP
};
```

## File: src/db.js
```javascript
const { MongoClient } = require('mongodb');
require('dotenv').config();
const client = new MongoClient(process.env.MONGO_URI, {
  maxPoolSize: 5,
  minPoolSize: 1,
  connectTimeoutMS: 3000,
  serverSelectionTimeoutMS: 3000,
  socketTimeoutMS: 2000
});
let dbConnection = null;
let isConnecting = false;
module.exports = {
  connect: async () => {
    if (dbConnection) return dbConnection;
    if (isConnecting) {
      await new Promise(resolve => setTimeout(resolve, 100));
      return dbConnection;
    }
    try {
      isConnecting = true;
      await client.connect();
      dbConnection = client.db(process.env.MONGO_DB);
      console.log('✅ MongoDB Connected');
      return dbConnection;
    } catch (error) {
      console.error('❌ MongoDB Connection Failed:', error);
      throw error;
    } finally {
      isConnecting = false;
    }
  },
  connect: async () => {
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
      dbConnection = client.db(process.env.MONGO_DB);
      console.log('📦 Connected to MongoDB (new connection)');
      client.on('serverClosed', (e) => console.log('[MongoDB] Connection closed:', e));
      client.on('serverOpening', (e) => console.log('[MongoDB] Reconnecting:', e));
      client.on('serverHeartbeatFailed', (e) => console.error('[MongoDB] Heartbeat failed:', e));
      return dbConnection;
    } catch (error) {
      console.error('[MongoDB] Connection failed:', error);
      throw error;
    } finally {
      isConnecting = false;
    }
  },
  getCollection: async (name) => {
    const db = await module.exports.connect();
    return db.collection(name);
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
```

## File: src/generate_session.js
```javascript
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
```

## File: src/index.js
```javascript
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
```

## File: src/processors.js
```javascript
const { downloadVideo } = require('./aria2');
const { delay } = require('./utils');
const { getFileSize } = require('./utils');
const { waitRandom } = require('./utils');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { connect } = require('puppeteer-real-browser');
async function processUrl(url, doc, resolution, retryAttempt = 0) {
    const maxRetries = 2;
    let browser, page;
    let tempDir = null;
    try {
      console.log(`[Processors] Creating temporary directory for browser data...`);
      tempDir = path.join(os.tmpdir(), `chrome-data-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });
      console.log(`[Processors] Connecting to browser...`);
      const connection = await connect({
        headless: false,
        turnstile: true,
        disableXvfb: false,
        defaultViewport: null,
      });
      browser = connection.browser;
      page = connection.page;
      console.log(`[Processors] Setting page timeouts and enabling JS...`);
      await page.setDefaultNavigationTimeout(0);
      await page.setDefaultTimeout(120000);
      await page.setJavaScriptEnabled(true);
      await page.setBypassCSP(true);
      page.on('popup', async popup => {
        const popupUrl = popup.url();
        if (!popupUrl.includes('download') && !popupUrl.includes('cloudflare')) {
          console.log(`[Processors] Blocked non-essential popup: ${popupUrl}`);
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
      const frames = await page.frames();
      const targetFrame = frames.find(frame =>
        frame.url().includes('download') || frame.url().includes('video')
      );
      if (!targetFrame) {
        throw new Error("Could not find download frame");
      }
      console.log(`[Processors] Found download frame, clicking download button...`);
      const [response] = await Promise.all([
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
      if (retryAttempt < maxRetries) {
        console.log(`[Processors] Retrying... Attempt ${retryAttempt + 1} of ${maxRetries}`);
        return processUrl(url, doc, resolution, retryAttempt + 1);
      }
      throw error;
    } finally {
      if (browser) {
        console.log(`[Processors] Closing browser...`);
        await browser.close().catch(console.error);
      }
      if (tempDir) {
        console.log(`[Processors] Removing temporary directory...`);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }
module.exports = {
    processUrl
};
```

## File: src/telegram.js
```javascript
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
```

## File: src/utils.js
```javascript
module.exports = {
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
          await module.exports.delay(delayMs);
          return module.exports.withRetry(fn, retries - 1, delayMs * 2);
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
  })
};
```

## File: src/workers/aria2Worker.js
```javascript
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
```

## File: src/workers/baseWorker.js
```javascript
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
      let doc;
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
```

## File: src/workers/downloadWorker.js
```javascript
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
        $or: [
          { processingStatus: { $exists: false } },
          { processingStatus: PROCESSING_STATUS.PENDING }
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
```

## File: src/workers/telegramWorker.js
```javascript
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
```
