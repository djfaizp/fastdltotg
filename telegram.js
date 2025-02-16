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
            connectionRetries: 10,           // Increased from 5
            maxConcurrentDownloads: 8,      // Increased from 1
            useWSS: true,                   // Enabled WebSocket
            requestRetries: 3,              // Reduced from 5
            downloadRetries: 3,             // Reduced from 5
            uploadRetries: 3,               // Reduced from 5
            retryDelay: 1000,              // Reduced from 2000
            workers: 8,                     // Increased from 4
            maxUploadParts: 4000,           // Added for larger chunks
            dcId: 2,                        // Frankfurt DC for European users
            useIPV6: false,                 // Disable IPv6 for faster connection
            timeout: 30000                  // 30 second timeout
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

        // Get file size
        const stats = fs.statSync(filePath);
        const fileSize = stats.size;
        const fileSizeInMB = fileSize / (1024 * 1024);

        // Check file size limit (2GB = 2048MB)
        if (fileSizeInMB > 2048) {
            throw new Error(`❌ File size (${fileSizeInMB.toFixed(2)}MB) exceeds Telegram's 2GB limit`);
        }

        console.log(`📤 Preparing to upload ${path.basename(filePath)} (${fileSizeInMB.toFixed(2)}MB) to Telegram...`);

        // Validate channelId
        if (!channelId.startsWith('-100')) {
            console.error('❌ Invalid channelId. It must start with -100.');
            throw new Error('Invalid channelId. Ensure it starts with -100.');
        }

        let lastProgress = 0;
        let lastProgressUpdate = Date.now();
        const PROGRESS_UPDATE_INTERVAL = 1000; // Reduced from 2000

        // Upload file with optimized settings
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
            workers: 8,                    // Increased workers
            forceDocument: true,
            partSize: 1024 * 1024,          // 512KB chunks for better performance
            noWait: true,                  // Don't wait for server acknowledgment
            attributes: [
                new Api.DocumentAttributeFilename({
                    fileName: path.basename(filePath)
                })
            ]
        });

        // Get the message link
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
