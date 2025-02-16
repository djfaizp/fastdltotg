const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const path = require('path');
const fs = require('fs').promises;
require('dotenv').config();

// Cache environment variables
const ENV = Object.freeze({
    apiId: process.env.TELEGRAM_API_ID,
    apiHash: process.env.TELEGRAM_API_HASH,
    stringSession: process.env.TELEGRAM_STRING_SESSION,
    channelId: process.env.TELEGRAM_CHANNEL_ID
});

// Optimize client configuration
const CLIENT_CONFIG = Object.freeze({
    connectionRetries: 10,
    maxConcurrentDownloads: 8,      // Increased for better parallelization
    useWSS: true,
    requestRetries: 3,
    downloadRetries: 3,
    uploadRetries: 3,
    retryDelay: 1000,
    workers: 16,                     // Increased for better CPU utilization
    maxUploadParts: 4000,
    dcId: 2,                        // Frankfurt DC for European users
    useIPV6: false,
    timeout: 30000,
    connectionTimeout: 15000,        // Added specific connection timeout
    autoReconnect: true,            // Enable auto-reconnect
    floodSleepThreshold: 60,        // Sleep threshold for flood wait
    deviceModel: 'Server',          // Identify as server for better rate limits
    systemVersion: 'Linux',
    appVersion: '1.0.0',
    useWSS: true,                   // Use WebSocket for better stability
});

// Singleton client instance
let client = null;
let clientInitPromise = null;

// Utility functions with performance optimizations
const formatSize = (bytes) => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
};

const formatSpeed = (bytesPerSecond) => `${formatSize(bytesPerSecond)}/s`;

const createProgressBar = (progress, length = 20) => {
    const filled = Math.round(progress * length);
    return '█'.repeat(filled) + '░'.repeat(length - filled);
};

// Optimized client initialization with connection pooling
async function initializeClient() {
    if (clientInitPromise) {
        return clientInitPromise;
    }

    clientInitPromise = (async () => {
        if (!client) {
            if (!ENV.apiId || !ENV.apiHash || !ENV.stringSession || !ENV.channelId) {
                throw new Error('Missing required Telegram credentials');
            }

            client = new TelegramClient(
                new StringSession(ENV.stringSession),
                parseInt(ENV.apiId),
                ENV.apiHash,
                CLIENT_CONFIG
            );

            await client.connect();
            const me = await client.getMe();
            console.log('Connected to Telegram as:', me.username);

            // Setup automatic reconnection
            client.addEventHandler((update) => {
                if (update.disconnected) {
                    console.log('Disconnected from Telegram, reconnecting...');
                    client.connect();
                }
            });
        }
        return client;
    })();

    return clientInitPromise;
}

// Optimized upload function with chunked uploading and retry logic
async function uploadToTelegram(filePath, caption = '') {
    const maxRetries = 3;
    let attempt = 0;
    let lastError = null;

    while (attempt < maxRetries) {
        try {
            console.log(`🚀 Upload attempt ${attempt + 1}/${maxRetries}`);
            const client = await initializeClient();

            // Validate file
            const stats = await fs.stat(filePath);
            const fileSize = stats.size;
            const fileSizeInMB = fileSize / (1024 * 1024);

            if (fileSizeInMB > 2048) {
                throw new Error(`File size (${fileSizeInMB.toFixed(2)}MB) exceeds 2GB limit`);
            }

            // Optimize upload parameters
            let lastProgress = 0;
            let lastBytes = 0;
            let lastTime = Date.now();
            let startTime = Date.now();
            const PROGRESS_UPDATE_INTERVAL = 500;

            // Upload with optimized settings
            const result = await client.sendFile(ENV.channelId, {
                file: filePath,
                caption,
                progressCallback: (progress) => {
                    const now = Date.now();
                    if (now - lastTime >= PROGRESS_UPDATE_INTERVAL) {
                        const uploadedBytes = Math.floor(fileSize * progress);
                        const timeDiff = (now - lastTime) / 1000;
                        const bytesDiff = uploadedBytes - lastBytes;
                        const speed = bytesDiff / timeDiff;
                        
                        const remainingBytes = fileSize - uploadedBytes;
                        const eta = remainingBytes / speed;
                        const etaMinutes = Math.floor(eta / 60);
                        const etaSeconds = Math.floor(eta % 60);
                        
                        process.stdout.write('\r\x1b[K');
                        process.stdout.write(
                            `Uploading ${path.basename(filePath)}\n` +
                            `${createProgressBar(progress)} ${Math.floor(progress * 100)}%\n` +
                            `${formatSize(uploadedBytes)} of ${formatSize(fileSize)} at ${formatSpeed(speed)}\n` +
                            `ETA: ${etaMinutes}m ${etaSeconds}s`
                        );
                        
                        lastProgress = progress;
                        lastBytes = uploadedBytes;
                        lastTime = now;
                    }
                },
                workers: CLIENT_CONFIG.workers,
                forceDocument: true,
                partSize: 512 * 1024,
                noWait: true,
                attributes: [
                    new Api.DocumentAttributeFilename({
                        fileName: path.basename(filePath)
                    })
                ]
            });

            process.stdout.write('\r\x1b[K');
            const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`✅ Upload completed in ${totalTime}s`);
            
            const messageLink = `https://t.me/c/${ENV.channelId.toString().replace('-100', '')}/${result.id}`;
            console.log('📎 Message link:', messageLink);

            return {
                success: true,
                messageId: result.id,
                messageLink,
                fileSize: fileSizeInMB,
                fileName: path.basename(filePath),
                uploadDuration: totalTime
            };

        } catch (error) {
            lastError = error;
            process.stdout.write('\r\x1b[K');
            console.error(`❌ Upload attempt ${attempt + 1} failed:`, error.message);

            if (error.message.includes('FLOOD_WAIT_')) {
                const seconds = parseInt(error.message.match(/FLOOD_WAIT_(\d+)/)[1]);
                console.warn(`⏳ Rate limit hit. Waiting ${seconds} seconds...`);
                await new Promise(res => setTimeout(res, seconds * 1000));
            } else {
                await new Promise(res => setTimeout(res, 5000 * (attempt + 1)));
            }
            
            attempt++;
        }
    }

    throw lastError || new Error('Upload failed after maximum retries');
}

// Optimized cleanup function
async function closeClient() {
    if (client) {
        try {
            await client.disconnect();
            client = null;
            clientInitPromise = null;
            console.log('Telegram client disconnected');
        } catch (error) {
            console.error('Error disconnecting Telegram client:', error);
        }
    }
}

// Setup graceful shutdown
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
