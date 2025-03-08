import Aria2 from 'aria2';
import * as path from 'path';
import { getCollection } from './db.js';
const { uploadToTelegram } = await import('./telegram_python_bridge.js');
import { promises as fs } from 'fs';
import 'dotenv/config';

const secret = process.env.ARIA2_SECRET;
console.log('🔐 Initializing Aria2 client with host:', process.env.ARIA2_HOST, 'port:', process.env.ARIA2_PORT);
if (!secret) {
    console.warn('⚠️ ARIA2_SECRET environment variable is not set!');
}

const aria2Config = {
    host: process.env.ARIA2_HOST || "localhost",
    port: parseInt(process.env.ARIA2_PORT) || 6800,
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
        try {
            aria2Instance = new Aria2(aria2Config);
            console.log('✅ Aria2 client initialized successfully');
        } catch (error) {
            console.error('❌ Error initializing Aria2 client:', error);
            throw error;
        }
    }
    return aria2Instance;
};

// Test the connection when the module loads
(async () => {
    try {
        const client = getAria2Client();
        const version = await client.call('getVersion');
        console.log('✅ Connected to Aria2 server. Version:', version.version);
    } catch (error) {
        console.error('❌ Failed to connect to Aria2 server:', error.message);
    }
})();

const EMOJI_MAP = {
    movie: '🎬',
    file: '📁',
    language: '🗣️',
    originalLanguage: '🌍',
    runtime: '⏱️',
    genres: '🎭'
};

const { processCache } = await import('./db.js');
function sanitizeMetadata(doc) {
    const cacheKey = `meta_${doc._id?.toString()}`;
    const cached = processCache.get(cacheKey);
    if (cached) return cached;
    
    const sanitized = {
        title: String(doc.Movie || doc.title || '').trim(),
        language: String(doc.Language || doc.language || '').trim(),
        originalLanguage: String(doc["Original Language"] || doc.originalLanguage || '').trim(),
        runtime: String(doc.Runtime || doc.runtime || '').trim(),
        genres: []
    };
    
    if (doc.Genres || doc.genres) {
        const rawGenres = doc.Genres || doc.genres;
        if (Array.isArray(rawGenres)) {
            sanitized.genres = rawGenres.filter(Boolean).map(String);
        } else if (typeof rawGenres === 'string') {
            sanitized.genres = rawGenres.split(',').map(g => g.trim()).filter(Boolean);
        }
    }

    if (cacheKey) {
        processCache.set(cacheKey, sanitized, 300); // 5 minute TTL
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
    
    return `📁 ${fileName}
🎬 ${metadata.Movie || 'N/A'}
🗣️ ${metadata.Language || 'N/A'}
🌍 ${metadata['Original Language'] || 'N/A'}
⏱️ ${metadata.Runtime || 'N/A'}
🎭 ${metadata.Genres || 'N/A'}`;
};

const DEFAULT_DOWNLOAD_OPTIONS = {
    split: '1',
    'max-connection-per-server': '1',
    'continue': false,
    'allow-overwrite': 'true',
    'auto-file-renaming': 'false',
    'piece-length': '1M',
    'lowest-speed-limit': '1K',
    'max-tries': '5',
    'retry-wait': '10',
    timeout: '600',
    'connect-timeout': '60',
    'max-file-not-found': '5',
    'stream-piece-selector': 'default',
    'disk-cache': '64M',
    'file-allocation': 'none',
    'async-dns': 'true',
    'enable-http-keep-alive': 'true',
    'enable-http-pipelining': 'false',
    'header': 'Accept: */*'
};

async function downloadVideo(url, dir = process.env.ARIA2_DOWNLOAD_DIR, metadata = {}) {
    const aria2 = getAria2Client();
    let currentGuid = null;
    let downloadedFilePath = null;

    try {
        const options = { ...DEFAULT_DOWNLOAD_OPTIONS, dir };
        
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
        
        // Fix the import path here
        
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
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
        if (downloadedFilePath) {
            await fs.unlink(downloadedFilePath).catch(() => {});
        }
        if (currentGuid) {
            await aria2.call('removeDownloadResult', currentGuid).catch(() => {});
        }
    }
}

export { 
    downloadVideo, 
    formatCaption, 
    formatMetadata,
    EMOJI_MAP
};
