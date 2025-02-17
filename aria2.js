const Aria2 = require('aria2');
const path = require('path');
const { getCollection } = require('./db');
const fs = require('fs').promises; // Use promises version for better async handling
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
      
      // Add error handlers
      aria2Instance.on('error', (err) => {
        console.error('❌ Aria2 connection error:', err);
        aria2Instance = null;  // Force reconnect on next call
      });
  
      aria2Instance.on('open', () => 
        console.log('✅ Aria2 connection established'));
        
      aria2Instance.on('close', () => 
        console.warn('⚠️ Aria2 connection closed'));
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
    'stream-piece-selector': 'geom',  // Geometric piece selection for better throughput
    'disk-cache': '64M',             // Disk cache for better I/O
    'file-allocation': 'none',       // Faster file allocation
    'async-dns': 'true',            // Async DNS resolution
    'enable-http-keep-alive': 'true', // Keep-alive connections
    'enable-http-pipelining': 'true'  // HTTP pipelining
});

async function downloadVideo(url, dir = process.env.ARIA2_DOWNLOAD_DIR, metadata = {}) {
    const aria2 = getAria2Client();
    let currentGuid = null;
    let downloadedFilePath = null;

    try {
        // Validate inputs using Object.assign for performance
        const options = Object.assign({}, DEFAULT_DOWNLOAD_OPTIONS, { dir });
        
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
        const caption = formatCaption(metadata, path.basename(downloadedFilePath));
        
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
                { w: 1 } // Optimize write concern
            );
        }

        return { success: true, ...uploadResult };
    } catch (error) {
        console.error('Download error:', error);
        return { success: false, error: error.message };
    } finally {
        // Cleanup with optimized async operations
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
    EMOJI_MAP // Export for testing purposes
};
