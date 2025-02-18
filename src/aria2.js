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
                
            // Test connection and ensure it's open
            await aria2Instance.open();
            const version = await aria2Instance.call('getVersion');
            console.log('[Aria2] Connected to aria2 version:', version.version);
        } catch (err) {
            console.error('[Aria2] Failed to initialize client:', err);
            aria2Instance = null;
            throw err;
        }
    }
    
    // Test connection by making a simple call
    try {
        await aria2Instance.call('getVersion');
    } catch (err) {
        aria2Instance = null;
        throw new Error('Failed to reconnect to aria2: ' + err.message);
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
    let aria2;
    let currentGuid = null;
    let downloadedFilePath = null;

    try {
        // Ensure download directory exists
        try {
            await fs.mkdir(dir, { recursive: true });
        } catch (err) {
            console.error(`Failed to create download directory ${dir}:`, err);
            throw new Error(`Failed to create download directory: ${err.message}`);
        }

        // Get client with retry logic
        for (let i = 0; i < 3; i++) {
            try {
                aria2 = await getAria2Client();
                await aria2.call('getVersion');
                break;
            } catch (err) {
                if (i === 2) throw err;
                console.log(`[Aria2] Retrying connection (${i + 1}/3)...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // Extract filename from metadata or URL
        let filename;
        if (metadata.filename) {
            filename = metadata.filename;
        } else {
            const urlObj = new URL(url);
            const originalFilename = path.basename(urlObj.pathname);
            filename = originalFilename.split('?')[0];
        }
        
        const options = {
            ...DEFAULT_DOWNLOAD_OPTIONS,
            dir,
            'out': filename,
            'max-tries': '5',
            'retry-wait': '10',
            'connect-timeout': '30',
            'timeout': '600',
            'max-connection-per-server': '16',
            'split': '16'
        };
        
        console.log(`📥 Downloading ${filename} from ${url}`);
        
        // Verify connection before starting download
        await aria2.call('getVersion');
        currentGuid = await aria2.call('addUri', [url], options);
        
        // Monitor download progress with timeout
        const status = await new Promise((resolve, reject) => {
            let lastUpdate = Date.now();
            let lastProgress = 0;
            let staleCount = 0;
            const MAX_STALE_COUNT = 5; // Maximum number of stale progress checks

            const checkStatus = async () => {
                try {
                    const status = await aria2.call('tellStatus', currentGuid);
                    
                    const now = Date.now();
                    if (now - lastUpdate > 1000) {
                        const progress = parseInt(status.completedLength) / parseInt(status.totalLength);
                        
                        // Check if progress is stale
                        if (!isNaN(progress) && progress === lastProgress) {
                            staleCount++;
                            if (staleCount >= MAX_STALE_COUNT) {
                                reject(new Error('Download stalled - no progress'));
                                return;
                            }
                        } else {
                            staleCount = 0;
                            lastProgress = progress;
                        }

                        process.stdout.write(`Progress: ${(progress * 100).toFixed(1)}%`);
                        lastUpdate = now;
                    }

                    if (status.status === 'complete') {
                        console.log(`\n✅ Download completed: ${filename}`);
                        resolve(status);
                    } else if (status.status === 'error') {
                        reject(new Error(status.errorMessage || 'Download failed'));
                    } else {
                        setTimeout(checkStatus, 1000);
                    }
                } catch (error) {
                    reject(error);
                }
            };
            
            // Set overall timeout
            const timeout = setTimeout(() => {
                reject(new Error('Download timeout after 10 minutes'));
            }, 600000); // 10 minutes

            checkStatus().finally(() => clearTimeout(timeout));
        });

        downloadedFilePath = status.files[0]?.path;
        return { 
            success: true, 
            filePath: downloadedFilePath,
            messageLink: null // Will be set by telegram upload
        };
    } catch (error) {
        console.error('❌ Download error:', error);
        // Try to clean up failed download
        if (currentGuid) {
            try {
                await aria2.call('remove', currentGuid);
            } catch (e) {
                console.error('Failed to clean up download:', e);
            }
        }
        return { success: false, error: error.message };
    }
}
module.exports = {
    getAria2Client,
    downloadVideo,
    formatCaption,
    formatMetadata,
    EMOJI_MAP
};
