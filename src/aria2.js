const Aria2 = require('aria2');
const path = require('path');
const { getCollection } = require('./db');

const DEFAULT_DOWNLOAD_OPTIONS = {
    'continue': true,
    'max-connection-per-server': 10,
    'min-split-size': '10M',
    'split': 10,
    'file-allocation': 'none'
};

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
            
            // Add error handlers
            aria2Instance.on('error', (err) => {
                console.error('❌ Aria2 connection error:', err);
                aria2Instance = null;  // Force reconnect on next call
            });
        
            aria2Instance.on('open', () =>
                console.log('✅ Aria2 connection established'));
                
            aria2Instance.on('close', () =>
                console.warn('⚠️ Aria2 connection closed'));
                
            // Test connection
            await aria2Instance.open();
            await aria2Instance.call('getVersion');
        } catch (err) {
            aria2Instance = null;
            throw err;
        }
    }
    return aria2Instance;
};
  

// Cache emoji map
const EMOJI_MAP = Object.freeze({
    movie: '🎬',
    file: '📁',
    language: '🗣️',
    originalLanguage: '🌍',
    runtime: '⏱️',
    genres: '🎭'
});

// Memoize sanitized metadata
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

// Optimize caption formatting with template literals
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
        // Extract filename from URL
        const urlObj = new URL(url);
        const originalFilename = path.basename(urlObj.pathname);
        
        // Clean the filename (remove query parameters if present)
        const cleanFilename = originalFilename.split('?')[0];
        
        // Create options with the extracted filename
        const options = {
            ...DEFAULT_DOWNLOAD_OPTIONS,
            dir,
            'out': cleanFilename
        };
        
        console.log(`📥 Downloading ${cleanFilename} from ${url}`);
        
        // Start download with optimized options
        currentGuid = await aria2.call('addUri', [url], options);
        
        // Monitor download progress with optimized polling
        const status = await new Promise((resolve, reject) => {
            let lastUpdate = Date.now();
            const checkStatus = async () => {
                try {
                    const status = await aria2.call('tellStatus', currentGuid);
                    
                    // Update progress less frequently
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
        
        // Optimize file reading for Telegram upload
        const { uploadToTelegram } = require('./telegram');
        const caption = formatCaption(metadata, cleanFilename);
        
        const uploadResult = await uploadToTelegram(downloadedFilePath, caption);
        
        // Batch MongoDB updates
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
        // Cleanup with optimized async operations
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
