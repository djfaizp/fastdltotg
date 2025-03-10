import { TelegramClient } from 'telegram/client/TelegramClient.js';
import { StringSession } from 'telegram/sessions/StringSession.js';
import { Api } from 'telegram/tl/api.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const apiId = process.env.TELEGRAM_API_ID;
const apiHash = process.env.TELEGRAM_API_HASH;
const stringSession = new StringSession(process.env.TELEGRAM_STRING_SESSION);
const channelId = process.env.TELEGRAM_CHANNEL_ID;
let client = null;

class TelegramUploadError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'TelegramUploadError';
        this.details = details;
    }
}

const retry = async (fn, maxRetries = 5, initialDelay = 500) => {
    let retries = 0;
    while (retries < maxRetries) {
        try {
            return await fn();
        } catch (error) {
            if (retries === maxRetries - 1) throw error;
            const delay = initialDelay * Math.pow(2, retries);
            console.warn(`Retry ${retries + 1}/${maxRetries} after ${delay}ms`);
            await new Promise(res => setTimeout(res, delay));
            retries++;
        }
    }
};

const optimizeConnection = async (client) => {
    try {
        // Use invoke instead of invokeApi
        const nearestDc = await client.invoke(new Api.help.GetNearestDc());
        if (nearestDc.nearestDc !== nearestDc.thisDc) {
            await client.connect();
        }
        return true;
    } catch (error) {
        console.warn('Connection optimization failed:', error);
        return false;
    }
};

const optimizeMemory = () => {
    if (global.gc) {
        global.gc();
    }
    process.memoryUsage();
};

async function initializeClient() {
    if (!client) {
        if (!apiId || !apiHash || !stringSession || !channelId) {
            throw new Error('Missing required Telegram credentials');
        }
        
        client = new TelegramClient(stringSession, parseInt(apiId), apiHash, {
            connectionRetries: 5,
            maxConcurrentDownloads: 16,    // Increased for parallel operations
            useWSS: false,                 // Using raw TCP for better speed
            requestRetries: 3,
            downloadRetries: 3,
            uploadRetries: 3,
            retryDelay: 250,              // Reduced delay
            workers: 16,                   // Increased worker count
            timeout: 30000,
            connection: {
                compression: false,        // Disable compression for speed
                testServers: false,
                tcpMtproto: true,         // Use MTProto directly
                fastUpload: true,         // Enable fast upload mode
                fastConnect: true,        // Enable fast connect
                retransmitTimeout: 2000   // Lower timeout for retransmissions
            },
            maxUploadParts: 20000,        // Increased for larger chunks
            uploadChunkSize: 512 * 1024,  // 512KB chunks
            dcId: 2,                      // Use DC-2 (usually faster)
            useIPV6: false,
            floodSleepThreshold: 60
        });
        
        await client.connect();
        console.log('Connected to Telegram as:', (await client.getMe()).username);
    }
    return client;
}

async function uploadToTelegram(filePath, caption = '') {
    let retries = 0;
    const maxRetries = 5;
    
    while (retries < maxRetries) {
        try {
            const client = await initializeClient();
            
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            const stats = fs.statSync(filePath);
            const fileSize = stats.size;
            const fileSizeInMB = fileSize / (1024 * 1024);

            if (fileSizeInMB > 2048) {
                throw new Error(`File size ${fileSizeInMB.toFixed(2)}MB exceeds 2GB limit`);
            }

            console.log(`📤 Uploading ${path.basename(filePath)} (${fileSizeInMB.toFixed(2)}MB)`);

            const startTime = Date.now();
            let lastProgress = 0;
            let lastSpeedUpdate = Date.now();
            let speedHistory = [];

            const result = await client.sendFile(channelId, {
                file: {
                    path: filePath,
                    size: fileSize
                },
                caption: caption,
                progressCallback: (progress) => {
                    if (progress && typeof progress === 'number') {
                        const now = Date.now();
                        const currentProgress = Math.floor(progress * 100);
                        const uploadedBytes = Math.floor(fileSize * progress);
                        const elapsedTime = (now - startTime) / 1000;
                        const speed = uploadedBytes / elapsedTime / (1024 * 1024);
                        
                        // Update speed history every second
                        if (now - lastSpeedUpdate >= 1000) {
                            speedHistory.push(speed);
                            if (speedHistory.length > 5) speedHistory.shift();
                            lastSpeedUpdate = now;
                        }
                        
                        // Calculate average speed
                        const avgSpeed = speedHistory.reduce((a, b) => a + b, 0) / speedHistory.length;
                        
                        if (currentProgress > lastProgress) {
                            console.log(`⬆️ Progress: ${currentProgress}% | Speed: ${avgSpeed.toFixed(2)} MB/s | ETA: ${((fileSize - uploadedBytes) / (avgSpeed * 1024 * 1024)).toFixed(0)}s`);
                            lastProgress = currentProgress;
                        }
                    }
                },
                workers: 16,               // Increased workers
                forceDocument: true,
                fileSize: fileSize,
                fileName: path.basename(filePath),
                parallelTransfers: 16,     // Enable parallel transfers
                noWait: true,             // Don't wait for server confirmation
                chunkSize: 512 * 1024,    // 512KB chunks
                fastMode: true            // Enable fast mode
            });

            const messageLink = `https://t.me/c/${channelId.replace('-100', '')}/${result.id}`;
            console.log('✅ Upload complete:', messageLink);

            return {
                success: true,
                messageId: result.id,
                messageLink,
                fileSize: fileSizeInMB,
                fileName: path.basename(filePath)
            };

        } catch (error) {
            console.error(`Upload attempt ${retries + 1} failed:`, error.message);
            
            if (error.message.includes('FLOOD_WAIT_')) {
                const seconds = parseInt(error.message.match(/FLOOD_WAIT_(\d+)/)[1]);
                console.log(`⏳ Rate limit hit. Waiting ${seconds}s...`);
                await new Promise(res => setTimeout(res, seconds * 1000));
                continue;
            }

            retries++;
            if (retries < maxRetries) {
                const delay = Math.pow(2, retries) * 250;  // Reduced retry delay
                console.log(`Retry ${retries}/${maxRetries} after ${delay}ms`);
                await new Promise(res => setTimeout(res, delay));
            } else {
                throw new Error(`Upload failed after ${maxRetries} attempts: ${error.message}`);
            }
        }
    }
}
const validateFile = async (filePath) => {
    if (!fs.existsSync(filePath)) {
        throw new TelegramUploadError(`File not found: ${filePath}`);
    }

    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    const fileSizeInMB = fileSize / (1024 * 1024);

    if (fileSizeInMB > 2048) {
        throw new TelegramUploadError(
            `File size exceeds limit`,
            { size: fileSizeInMB, limit: 2048 }
        );
    }

    try {
        await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
        throw new TelegramUploadError(`File is not readable: ${filePath}`);
    }

    return { fileSize, fileSizeInMB };
};

class UploadProgress {
    constructor(fileSize) {
        this.fileSize = fileSize;
        this.startTime = Date.now();
        this.lastUpdate = 0;
        this.lastProgress = 0;
    }

    update(progress) {
        const now = Date.now();
        const currentProgress = Math.floor(progress * 100);
        
        if (now - this.lastUpdate >= 1000 && currentProgress > this.lastProgress) {
            const uploadedBytes = Math.floor(this.fileSize * progress);
            const elapsed = (now - this.startTime) / 1000;
            const speed = (uploadedBytes / elapsed / (1024 * 1024)).toFixed(2);
            
            console.log(
                `⬆️ Progress: ${currentProgress}% | Speed: ${speed} MB/s`
            );
            
            this.lastUpdate = now;
            this.lastProgress = currentProgress;
        }
    }
}


async function uploadLargeFile(filePath, caption = '') {
    try {
        const client = await retry(() => initializeClient());
        const { fileSize, fileSizeInMB } = await validateFile(filePath);

        const stream = fs.createReadStream(filePath, {
            highWaterMark: 1024 * 1024 * 8
        });

        const progress = new UploadProgress(fileSize);

        console.log(`📤 Uploading large file: ${path.basename(filePath)} (${fileSizeInMB.toFixed(2)}MB)`);

        const result = await retry(() => client.sendFile(channelId, {
            file: stream,
            caption,
            progressCallback: (p) => progress.update(p),
            workers: 64,
            forceDocument: true,
            partSize: 8 * 1024 * 1024,
            noWait: true,
            uploadMode: 'parallel',
            attributes: [
                new Api.DocumentAttributeFilename({
                    fileName: path.basename(filePath)
                })
            ]
        }));

        const messageLink = `https://t.me/c/${channelId.replace('-100', '')}/${result.id}`;
        return { success: true, messageId: result.id, messageLink };

    } catch (error) {
        throw new TelegramUploadError('Large file upload failed', { originalError: error.message });
    }
}

const cleanupResources = async () => {
    if (client) {
        try {
            await client.disconnect();
            client = null;
            console.log('🔌 Telegram client disconnected');
        } catch (error) {
            console.error('❌ Error during cleanup:', error);
        }
    }
};

for (const signal of ['SIGINT', 'SIGTERM', 'SIGUSR2']) {
    process.on(signal, async () => {
        console.log(`Received ${signal}. Cleaning up...`);
        await cleanupResources();
        process.exit(0);
    });
}

process.on('uncaughtException', async (error) => {
    console.error('Uncaught Exception:', error);
    await cleanupResources();
    process.exit(1);
});

export { uploadToTelegram, uploadLargeFile, cleanupResources };

