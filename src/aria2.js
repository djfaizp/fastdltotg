const Aria2 = require('aria2');
const path = require('path');
const { getCollection } = require('./db');
const fs = require('fs').promises;
const { createReadStream } = require('fs');
require('dotenv').config();

// Enhanced default download options
const DEFAULT_DOWNLOAD_OPTIONS = {
    'continue': true,
    'max-connection-per-server': 16,      // Increased from 10
    'min-split-size': '1M',              // Reduced for better stability
    'split': 1,                          // Disabled parallel chunking as requested
    'file-allocation': 'none',           // Keep as none for faster starts
    'allow-piece-length-change': false,  // Added as requested
    'auto-file-renaming': true,          // Added as requested
    'max-tries': 10,                     // Increased retry attempts
    'retry-wait': 10,                    // 10 seconds between retries
    'connect-timeout': 30,               // 30 second connection timeout
    'stream-piece-selector': 'inorder',  // Sequential download
    'conditional-get': true,             // Enable conditional GET
    'no-netrc': true,                    // Disable netrc for security
    'max-file-not-found': 5,            // Max number of file not found attempts
    'max-resume-failure-tries': 5,       // Max resume failure attempts
    'retry-on-400': true,               // Retry on bad request
    'retry-on-403': true,               // Retry on forbidden
    'retry-on-406': true,               // Retry on not acceptable
    'retry-on-unknown': true,           // Retry on unknown errors
    'reuse-uri': true,                  // Reuse URIs for better performance
    'http-accept-gzip': true,           // Enable gzip compression
    'optimize-concurrent-downloads': true // Optimize concurrent downloads
};

// Enhanced aria2 configuration
const aria2Config = Object.freeze({
    host: process.env.ARIA2_HOST || 'localhost',
    port: parseInt(process.env.ARIA2_PORT) || 6800,
    secure: process.env.ARIA2_SECURE === 'true',
    secret: process.env.ARIA2_SECRET,
    path: '/jsonrpc',
    'max-concurrent-downloads': parseInt(process.env.ARIA2_MAX_CONCURRENT_DOWNLOADS) || 3,
    ...DEFAULT_DOWNLOAD_OPTIONS,
    'out': '' // Will be set dynamically
});

let aria2Instance = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 2000;

const getAria2Client = async () => {
    if (!aria2Instance) {
        console.log('[Aria2] Creating new aria2 client instance');
        try {
            aria2Instance = new Aria2(aria2Config);
            
            // Enhanced error handling
            aria2Instance.on('error', (err) => {
                console.error('❌ Aria2 connection error:', err);
                aria2Instance = null;
                reconnectAttempts = 0;
            });
        
            aria2Instance.on('open', () => {
                console.log('✅ Aria2 connection established');
                reconnectAttempts = 0;
            });
                
            aria2Instance.on('close', () => {
                console.warn('⚠️ Aria2 connection closed');
                aria2Instance = null;
            });
                
            // Test connection and ensure it's open
            await aria2Instance.open();
            const version = await aria2Instance.call('getVersion');
            console.log('[Aria2] Connected to aria2 version:', version.version);

            // Initialize global settings
            await aria2Instance.call('changeGlobalOption', DEFAULT_DOWNLOAD_OPTIONS);
        } catch (err) {
            console.error('[Aria2] Failed to initialize client:', err);
            aria2Instance = null;
            throw err;
        }
    }
    
    // Enhanced connection testing
    try {
        await aria2Instance.call('getVersion');
    } catch (err) {
        aria2Instance = null;
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            console.log(`[Aria2] Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
            await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY));
            return getAria2Client();
        }
        throw new Error(`Failed to reconnect to aria2 after ${MAX_RECONNECT_ATTEMPTS} attempts: ${err.message}`);
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

        // Enhanced retry logic for client connection
        for (let i = 0; i < MAX_RECONNECT_ATTEMPTS; i++) {
            try {
                aria2 = await getAria2Client();
                await aria2.call('getVersion');
                break;
            } catch (err) {
                if (i === MAX_RECONNECT_ATTEMPTS - 1) throw err;
                console.log(`[Aria2] Retrying connection (${i + 1}/${MAX_RECONNECT_ATTEMPTS})...`);
                await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY));
            }
        }

        // Enhanced filename handling
        let filename;
        if (metadata.filename) {
            filename = metadata.filename;
        } else {
            const urlObj = new URL(url);
            const originalFilename = path.basename(urlObj.pathname);
            filename = originalFilename.split('?')[0];
        }
        
        // Enhanced download options
        const options = {
            ...DEFAULT_DOWNLOAD_OPTIONS,
            dir,
            'out': filename,
            'max-tries': '10',            // Increased from 5
            'retry-wait': '10',           // Increased from default
            'connect-timeout': '60',       // Increased from 30
            'timeout': '600',             // Keep 10-minute timeout
            'max-connection-per-server': '16',
            'split': 1                    // Ensure split is 1 as requested
        };
        
        console.log(`📥 Downloading ${filename} from ${url}`);
        
        // Verify connection before starting download
        await aria2.call('getVersion');
        currentGuid = await aria2.call('addUri', [url], options);
        
        // Enhanced progress monitoring
        const status = await new Promise((resolve, reject) => {
            let lastUpdate = Date.now();
            let lastProgress = 0;
            let staleCount = 0;
            const MAX_STALE_COUNT = 10; // Increased from 5
            const PROGRESS_CHECK_INTERVAL = 1000; // 1 second

            const checkStatus = async () => {
                try {
                    const status = await aria2.call('tellStatus', currentGuid);
                    
                    const now = Date.now();
                    if (now - lastUpdate > PROGRESS_CHECK_INTERVAL) {
                        const progress = parseInt(status.completedLength) / parseInt(status.totalLength);
                        
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

                        const speed = parseInt(status.downloadSpeed);
                        const eta = (parseInt(status.totalLength) - parseInt(status.completedLength)) / speed;
                        
                        process.stdout.write(
                            `Progress: ${(progress * 100).toFixed(1)}% | Speed: ${(speed/1024/1024).toFixed(2)} MB/s | ETA: ${Math.ceil(eta)}s\r`
                        );
                        
                        lastUpdate = now;
                    }

                    if (status.status === 'complete') {
                        console.log(`\n✅ Download completed: ${filename}`);
                        resolve(status);
                    } else if (status.status === 'error') {
                        reject(new Error(status.errorMessage || 'Download failed'));
                    } else {
                        setTimeout(checkStatus, PROGRESS_CHECK_INTERVAL);
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
        // Enhanced cleanup for failed downloads
        if (currentGuid) {
            try {
                await aria2.call('remove', currentGuid);
                // Also try to remove the incomplete file
                if (downloadedFilePath) {
                    await fs.unlink(downloadedFilePath).catch(() => {});
                }
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
