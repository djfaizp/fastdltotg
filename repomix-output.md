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
aria2.js
db.js
Dockerfile
generate_session.js
index.js
package.json
telegram.js
```

# Files

## File: aria2.js
```javascript
const Aria2 = require('aria2');
const path = require('path');
const { getCollection } = require('./db');
const fs = require('fs');
require('dotenv').config();
const secret = process.env.ARIA2_SECRET;
console.log('🔐 Initializing Aria2 client with host:', process.env.ARIA2_HOST, 'port:', process.env.ARIA2_PORT);
if (!secret) {
    console.warn('⚠️ ARIA2_SECRET environment variable is not set!');
}
const aria2 = new Aria2({
    host: "aria2",
    port: 6800,
    secure: false,
    secret: process.env.ARIA2_SECRET,
    path: '/jsonrpc'
});
aria2.on('error', (error) => {
    console.error('Aria2 WebSocket error:', error);
});
aria2.on('close', () => {
    console.log('Aria2 WebSocket connection closed');
});
aria2.on('websocket-error', (error) => {
    console.error('WebSocket connection error:', error);
});
aria2.on('socketHangup', () => {
    console.error('WebSocket connection hung up');
});
async function downloadVideo(url, dir = process.env.ARIA2_DOWNLOAD_DIR, metadata = {}) {
    let currentGuid = null;
    let downloadedFilePath = null;
    let fileSizeMB = null;
    if (!dir || !dir.startsWith('/aria2/data')) {
        throw new Error(`Invalid download directory: ${dir}. Must use Aria2's container path`);
    }
    const cleanup = async () => {
        if (currentGuid) {
            try {
                await aria2.call('removeDownloadResult', currentGuid);
            } catch (e) {
                console.log('Cleanup warning:', e.message);
            }
        }
        if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
            try {
                fs.unlinkSync(downloadedFilePath);
                console.log('🗑️ Cleaned up downloaded file:', downloadedFilePath);
            } catch (e) {
                console.error('Failed to clean up file:', e.message);
            }
        }
    };
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        let retries = 3;
        let connected = false;
        while (!connected && retries > 0) {
            try {
                await aria2.open();
                connected = true;
                console.log('📡 Aria2 connection opened');
            } catch (error) {
                retries--;
                if (retries > 0) {
                    console.log(`Connection failed, retrying... (${retries} attempts remaining)`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                } else {
                    throw new Error(`Failed to connect to Aria2 after multiple attempts: ${error.message}`);
                }
            }
        }
        if (!url || typeof url !== 'string') {
            throw new Error('Invalid download URL');
        }
        const options = {
            dir: dir,
            continue: true,
            split: '16',
            'max-connection-per-server': '16',
            'allow-overwrite': 'true',
            'auto-file-renaming': 'false',
            'piece-length': '1M',
            'lowest-speed-limit': '1K',
            'max-tries': '5',
            'retry-wait': '10',
            timeout: '600',
            'connect-timeout': '60',
            'max-file-not-found': '5'
        };
        console.log('⬇️ Starting download:', url);
        currentGuid = await aria2.call('addUri', [url], options);
        console.log('📥 Download started with ID:', currentGuid);
        const status = await waitForDownload(currentGuid);
        downloadedFilePath = status.files[0]?.path;
        if (!downloadedFilePath) {
            throw new Error('Download completed but file path is missing');
        }
        console.log('✅ Download completed successfully:', downloadedFilePath);
        const fileName = path.basename(downloadedFilePath);
        fileSizeMB = fs.statSync(downloadedFilePath).size / (1024 * 1024);
        const caption =
            `🎬 Movie: ${metadata.Movie || 'N/A'}\n` +
            `📁 Filename: ${fileName}\n` +
            `🗣️ Language: ${metadata.Language || 'N/A'}\n` +
            `🌍 Original Language: ${metadata['Original Language'] || 'N/A'}\n` +
            `⏱️ Runtime: ${metadata.Runtime || 'N/A'}\n` +
            `🎭 Genres: ${metadata.Genres || 'N/A'}`;
        console.log('🚀 Initiating Telegram upload...');
        const { uploadToTelegram } = require('./telegram');
        const telegramResult = await uploadToTelegram(downloadedFilePath, caption);
        if (!telegramResult.success) {
            throw new Error('Telegram upload failed: ' + telegramResult.error);
        }
        if (metadata._id && metadata.resolution) {
            const postsCollection = await getCollection('posts');
            await postsCollection.updateOne(
                { _id: metadata._id },
                {
                    $set: {
                        [`uploadedToTelegram.${metadata.resolution}`]: true,
                        [`telegramLinks.${metadata.resolution}`]: telegramResult.messageLink
                    }
                }
            );
            console.log('📝 Updated MongoDB document with Telegram upload status');
        }
        console.log('🎉 Process completed successfully!');
        console.log('📎 Telegram link:', telegramResult.messageLink);
        fs.unlinkSync(downloadedFilePath);
        console.log('🗑️ Local file cleaned up:', downloadedFilePath);
        return {
            success: true,
            guid: currentGuid,
            fileName: fileName,
            fileSize: fileSizeMB,
            telegram: telegramResult
        };
    } catch (error) {
        console.error('❌ Error during download/upload:', error.message);
        console.error('Full error:', error);
        return {
            success: false,
            skipped: true,
            reason: `Process failed: ${error.message}`,
            guid: currentGuid
        };
    } finally {
        try {
            await cleanup();
            await aria2.close();
            console.log('📡 Aria2 connection closed');
        } catch (error) {
            console.error('Error during cleanup/connection close:', error.message);
        }
    }
}
async function waitForDownload(guid) {
    return new Promise((resolve, reject) => {
        const checkInterval = 5000;
        let timer;
        let lastProgress = 0;
        let staleCount = 0;
        const MAX_STALE_CHECKS = 6;
        const checkStatus = async () => {
            try {
                const status = await aria2.call('tellStatus', guid);
                const completedLength = parseInt(status.completedLength, 10);
                const totalLength = parseInt(status.totalLength, 10);
                const speed = parseInt(status.downloadSpeed, 10);
                const progress = totalLength > 0 ?
                    ((completedLength / totalLength) * 100).toFixed(2) : 0;
                console.log(`⏳ Download progress: ${progress}% ` +
                    `(${(completedLength / 1024 / 1024).toFixed(2)}MB/` +
                    `${(totalLength / 1024 / 1024).toFixed(2)}MB) ` +
                    `Speed: ${(speed / 1024 / 1024).toFixed(2)}MB/s`);
                if (status.status === 'complete') {
                    clearInterval(timer);
                    resolve(status);
                } else if (status.status === 'error') {
                    clearInterval(timer);
                    reject(new Error(status.errorMessage || 'Download failed'));
                }
                if (completedLength === lastProgress) {
                    staleCount++;
                    if (staleCount >= MAX_STALE_CHECKS) {
                        clearInterval(timer);
                        reject(new Error('Download stalled - no progress for 30 seconds'));
                    }
                } else {
                    staleCount = 0;
                    lastProgress = completedLength;
                }
            } catch (error) {
                clearInterval(timer);
                reject(error);
            }
        };
        timer = setInterval(checkStatus, checkInterval);
        checkStatus();
    });
}
module.exports = { downloadVideo };
```

## File: db.js
```javascript
const { MongoClient } = require('mongodb');
require('dotenv').config();
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'scraper';
const RESOLUTIONS = ['480p', '720p', '1080p'];
let client = null;
async function connectToDb() {
  if (!client) {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    console.log('Connected to MongoDB');
  }
  return client;
}
async function getDb() {
  await connectToDb();
  return client.db(DB_NAME);
}
async function getCollection(collectionName) {
  const db = await getDb();
  return db.collection(collectionName);
}
async function closeConnection() {
  if (client) {
    await client.close();
    console.log('MongoDB connection closed');
    client = null;
  }
}
async function processAllPosts(scrapeCallback) {
  const collection = await getCollection('posts');
  const cursor = collection.find({
    isScraped: true,
    $or: RESOLUTIONS.map(res => ({
      [res]: { $exists: true },
      $and: [
        { [`directUrls.${res}`]: { $exists: false } },
        { [`skippedUrls.${res}`]: { $exists: false } }
      ]
    }))
  }).batchSize(1);
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    console.log(`\nProcessing document ${doc._id} - ${doc.title}`);
    try {
      await processDocument(doc, collection, scrapeCallback);
      console.log(`✅ Completed processing document ${doc._id}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`❌ Error processing document ${doc._id}:`, error);
    }
  }
}
async function processDocument(doc, collection, scrapeCallback) {
  const updates = {
    directUrls: {},
    errors: {},
    processingLog: [],
    skippedUrls: {}
  };
  for (const res of RESOLUTIONS) {
    const url = doc[res];
    if (!url) continue;
    if (doc.uploadedToTelegram?.[res]) {
      console.log(`📤 Skipping ${res} - already uploaded to Telegram`);
      updates.processingLog.push(`${new Date().toISOString()} - ${res} already uploaded to Telegram`);
      continue;
    }
    if (updates.directUrls[res]) {
      console.log(`Skipping already processed URL: ${updates.directUrls[res]}`);
      updates.skippedUrls[res] = {
        url: updates.directUrls[res],
        reason: 'Already processed'
      };
      continue;
    }
    try {
      updates.processingLog.push(`${new Date().toISOString()} - Starting ${res} processing`);
      const result = await scrapeCallback(url, doc, res);
      if (result && result.skipped) {
        updates.skippedUrls[res] = {
          url: result.url,
          reason: result.reason
        };
        updates.processingLog.push(`${new Date().toISOString()} - ${res} skipped: ${result.reason}`);
      } else {
        updates.directUrls[res] = result;
        updates.processingLog.push(`${new Date().toISOString()} - ${res} success: ${result}`);
        await collection.updateOne(
          { _id: doc._id },
          {
            $set: {
              [`directUrls.${res}`]: result,
              lastProcessed: new Date(),
              processingLog: updates.processingLog
            }
          }
        );
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      updates.errors[res] = {
        message: error.message,
        stack: error.stack
      };
      updates.processingLog.push(`${new Date().toISOString()} - ${res} error: ${error.message}`);
      await collection.updateOne(
        { _id: doc._id },
        {
          $set: {
            [`errors.${res}`]: {
              message: error.message,
              stack: error.stack
            },
            processingLog: updates.processingLog
          }
        }
      );
    }
  }
  await collection.updateOne(
    { _id: doc._id },
    {
      $set: updates,
      $inc: { processingAttempts: 1 }
    }
  );
}
module.exports = {
  getDb,
  getCollection,
  closeConnection,
  processAllPosts,
  processDocument,
};
```

## File: Dockerfile
```dockerfile
FROM node:18-bullseye

# Install system dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    xvfb \
    fonts-freefont-ttf \
    fonts-roboto \
    && rm -rf /var/lib/apt/lists/*

# Environment variables for Puppeteer
ENV CHROME_BIN=/usr/bin/chromium \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    DISPLAY=:99 \
    XVFB_WHD=1280x1024x16

# Create and configure directories
RUN mkdir -p /app/chrome-data /downloads && \
    chown -R node:node /app /downloads && \
    chmod -R 755 /downloads

WORKDIR /app

# Copy package files and install dependencies
COPY --chown=node:node package*.json ./
RUN npm install --production --omit=dev

# Copy application files
COPY --chown=node:node . .

# Switch to non-root user
USER node

# Expose application port
EXPOSE 1234

# Start application with Xvfb wrapper
CMD ["sh", "-c", "Xvfb :99 -ac -screen 0 $XVFB_WHD -nolisten tcp & npm start"]
```

## File: generate_session.js
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

## File: index.js
```javascript
const { connect } = require("puppeteer-real-browser");
const { processAllPosts, closeConnection } = require('./db');
const { downloadVideo } = require('./aria2');
const https = require('https');
const os = require('os');
const path = require('path');
const fs = require('fs');
function getFileSize(url) {
  return new Promise((resolve, reject) => {
    console.log('🔍 Checking file size for URL:', url);
    const request = https.get(url, (response) => {
      console.log('📨 Response headers:', response.headers);
      console.log('📊 Response status code:', response.statusCode);
      if (response.statusCode === 302 || response.statusCode === 301) {
        console.log('🔄 Following redirect to:', response.headers.location);
        return getFileSize(response.headers.location)
          .then(resolve)
          .catch(reject);
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP status code ${response.statusCode}`));
        return;
      }
      const contentLength = response.headers['content-length'];
      if (!contentLength) {
        console.log('⚠️ No content-length header found in response');
        resolve(null);
        return;
      }
      const size = parseInt(contentLength, 10);
      const sizeInMB = (size / (1024 * 1024)).toFixed(2);
      console.log(`📦 File size: ${sizeInMB} MB`);
      resolve(size);
    });
    request.on('error', (error) => {
      console.error('❌ Error during size check:', error.message);
      resolve(null);
    });
    request.setTimeout(60000, () => {
      request.destroy();
      console.log('⚠️ Size check timeout - continuing with download anyway');
      resolve(null);
    });
    request.end();
  });
}
function waitRandom(min, max) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
}
async function processUrl(url, doc, resolution, retryAttempt = 0) {
  const maxRetries = 2;
  let browser, page;
  let tempDir = null;
  try {
    tempDir = path.join(os.tmpdir(), `chrome-data-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const connection = await connect({
      headless: false,
      turnstile: true,
      disableXvfb: false,
      defaultViewport: null,
    });
    browser = connection.browser;
    page = connection.page;
    await page.setDefaultNavigationTimeout(0);
    await page.setDefaultTimeout(120000);
    await page.setJavaScriptEnabled(true);
    await page.setBypassCSP(true);
    page.on('popup', async popup => {
      const popupUrl = popup.url();
      if (!popupUrl.includes('download') && !popupUrl.includes('cloudflare')) {
        await popup.close();
        console.log('🚫 Blocked non-essential popup:', popupUrl);
      } else {
        console.log('🔵 Allowing download-related popup:', popupUrl);
      }
    });
    await page.evaluateOnNewDocument(() => {
      window.open = function() {};
      window.alert = function() {};
      window.confirm = function() { return true; };
      window.prompt = function() { return null; };
      Event.prototype.stopPropagation = function() {};
    });
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 120000
    });
    console.log('🟠 Waiting for Cloudflare Turnstile captcha to be solved...');
    await page.waitForFunction(() => {
      const input = document.querySelector('input[name="cf-turnstile-response"]');
      return input && input.value && input.value.trim().length > 30;
    }, { timeout: 300000 });
    await waitRandom(1000, 3000);
    console.log('🟢 Captcha solved! Initiating download...');
    let targetFrame = null;
    for (const frame of page.frames()) {
      try {
        await frame.waitForSelector('#download-button', { timeout: 15000 });
        targetFrame = frame;
        break;
      } catch (err) {
      }
    }
    if (!targetFrame) {
      throw new Error("Could not find frame with #download-button");
    }
    const [response] = await Promise.all([
      page.waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: 60000
      }),
      targetFrame.evaluate(() => {
        const btn = document.querySelector('#download-button');
        if (btn) {
          btn.click();
        }
      })
    ]);
    await page.waitForFunction(() => {
      const el = document.querySelector('#vd');
      return el && el.offsetHeight > 0 && el.href && el.href.length > 100;
    }, { timeout: 120000, polling: 'raf' });
    const videoUrl = await page.$eval('#vd', el => el.href);
    try {
        const sizeInBytes = await getFileSize(videoUrl);
        const sizeInGB = sizeInBytes / (1024 * 1024 * 1024);
        if (sizeInGB > 2) {
            console.log('⚠️ File size exceeds 2GB limit:', sizeInGB.toFixed(2), 'GB');
            return {
                skipped: true,
                reason: `File size (${sizeInGB.toFixed(2)}GB) exceeds 2GB limit`,
                url: videoUrl
            };
        }
        console.log('✅ Verified download URL:', videoUrl);
        const downloadResult = await downloadVideo(videoUrl, process.env.ARIA2_DOWNLOAD_DIR, {
            ...doc,
            resolution: resolution,
            Movie: doc.title,
            Language: doc.language,
            'Original Language': doc.originalLanguage,
            Runtime: doc.runtime,
            Genres: doc.genres?.join(', ')
        });
        if (!downloadResult.success) {
            console.error('❌ Download failed:', downloadResult.reason);
            return {
                skipped: true,
                reason: downloadResult.reason,
                url: videoUrl
            };
        }
        console.log('Aria2 download result:', downloadResult);
        return videoUrl;
    } catch (error) {
        console.error('❌ File size check failed:', error.message);
        console.log('⚠️ Proceeding with download without size check');
        const downloadResult = await downloadVideo(videoUrl, process.env.ARIA2_DOWNLOAD_DIR, {
            ...doc,
            resolution: resolution,
            Movie: doc.title,
            Language: doc.language,
            'Original Language': doc.originalLanguage,
            Runtime: doc.runtime,
            Genres: doc.genres?.join(', ')
        });
        if (!downloadResult.success) {
            throw new Error(downloadResult.reason || 'Download failed');
        }
        console.log('Aria2 download result:', downloadResult);
        return videoUrl;
    }
  } catch (error) {
    console.error('❌ Critical error:', error);
    if (retryAttempt < maxRetries) {
      console.log(`Retrying... Attempt ${retryAttempt + 1} of ${maxRetries}`);
      return processUrl(url, doc, resolution, retryAttempt + 1);
    }
    throw error;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (err) {
        console.log('Browser close error:', err.message);
      }
    }
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (e) {
        console.log('Failed to clean up temp directory:', e.message);
      }
    }
  }
}
['./chrome-data', './chrome-data/temp'].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o777 });
    }
});
processAllPosts(processUrl)
  .then(() => {
    console.log('All posts processed successfully.');
    return closeConnection();
  })
  .catch(err => {
    console.error('Error during post processing:', err);
    return closeConnection();
  });
```

## File: package.json
```json
{
    "name": "download-scraper",
    "version": "1.0.0",
    "main": "index.js",
    "scripts": {
        "start": "node index.js"
    },
    "dependencies": {
        "aria2": "^4.1.2",
        "cli-progress": "^3.12.0",
        "dotenv": "^16.4.7",
        "download-scraper": "file:",
        "mongodb": "^6.3.0",
        "puppeteer-real-browser": "^1.4.0",
        "telegram": "^2.26.22"
    }
}
```

## File: telegram.js
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
            connectionRetries: 5,
            maxConcurrentDownloads: 1,
            useWSS: false,
            requestRetries: 5,
            downloadRetries: 5,
            uploadRetries: 5,
            retryDelay: 2000,
            workers: 4
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
        const PROGRESS_UPDATE_INTERVAL = 2000;
        const result = await client.sendFile(channelId, {
            file: filePath,
            caption: caption,
            progressCallback: (progress) => {
                const now = Date.now();
                const currentProgress = Math.floor(progress.percent);
                console.log(`⬆️ Upload progress: ${currentProgress}% (Uploaded: ${progress.loaded} bytes)`);
                if (currentProgress >= lastProgress + 5 && now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
                    console.log(`⬆️ Upload progress: ${currentProgress}%`);
                    lastProgress = currentProgress;
                    lastProgressUpdate = now;
                }
            },
            workers: 4,
            forceDocument: true,
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
        if (error.code === 'ENOENT') {
            console.error('❌ File not found or inaccessible. Check the file path and permissions.');
        } else if (error.code === 'EACCES' || error.code === 'EPERM') {
            console.error('❌ Permission denied. Check file and directory permissions.');
        } else if (error.message.includes('AUTH_KEY_UNREGISTERED')) {
            throw new Error('❌ Telegram session expired. Please regenerate string session.');
        } else if (error.message.includes('FLOOD_WAIT_')) {
            const seconds = parseInt(error.message.match(/FLOOD_WAIT_(\d+)/)[1]);
            console.warn(`⏳ Flood wait error. Retrying in ${seconds} seconds...`);
            await new Promise(res => setTimeout(res, seconds * 1000));
            return uploadToTelegram(filePath, caption);
        } else if (error.message.includes('FILE_REFERENCE_')) {
            throw new Error('❌ File reference expired. Please try uploading again.');
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
