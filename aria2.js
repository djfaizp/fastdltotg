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
        throw new Error(`Invalid download directory: ${dir}. Must use Aria2's container path starting with /aria2/data`);
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
            `🎬 Movie: ${metadata.Movie || metadata.title || 'N/A'}\n` +
            `📁 Filename: ${fileName}\n` +
            `🗣️ Language: ${metadata.Language || metadata.language || 'N/A'}\n` +
            `🌍 Original Language: ${metadata['Original Language'] || metadata.originalLanguage || 'N/A'}\n` +
            `⏱️ Runtime: ${metadata.Runtime || metadata.runtime || 'N/A'}\n` +
            `🎭 Genres: ${metadata.Genres || (metadata.genres?.join(', ')) || 'N/A'}`;

        console.log('🚀 Initiating Telegram upload...');
        const { uploadToTelegram } = require('./telegram');
        const telegramResult = await uploadToTelegram(downloadedFilePath, caption);

        if (!telegramResult.success) {
            throw new Error('Telegram upload failed: ' + telegramResult.error);
        }

        // Add MongoDB update after successful Telegram upload
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
