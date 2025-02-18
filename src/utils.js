const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

const TEMP_DIR = path.join(os.tmpdir(), 'download-worker-temp');

// Ensure temp directory exists
async function ensureTempDir() {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

// Atomic write operation
async function safeWrite(filePath, content) {
  await ensureTempDir();
  const tempPath = path.join(TEMP_DIR, uuidv4());
  
  try {
    await fs.writeFile(tempPath, content);
    await fs.rename(tempPath, filePath);
  } catch (error) {
    // Clean up temp file if operation fails
    try {
      await fs.unlink(tempPath);
    } catch (cleanupError) {
      logger.error('Failed to clean up temp file:', cleanupError);
    }
    throw error;
  }
}

// Safe delete with retries
async function safeDelete(filePath, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      await fs.unlink(filePath);
      return;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(r => setTimeout(r, 100 * (2 ** i)));
    }
  }
}

// Clean up temp directory
async function cleanupTempDirs() {
  try {
    const files = await fs.readdir(TEMP_DIR);
    await Promise.all(
      files.map(file => 
        fs.rm(path.join(TEMP_DIR, file), { recursive: true, force: true })
      )
    );
  } catch (error) {
    logger.error('Failed to cleanup temp directories:', error);
  }
}

const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args)
};

module.exports = {
  logger,
  delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  waitRandom: (min, max) => {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
  },

  getFileSize: function(url) {
    const https = require('https');
    return new Promise((resolve, reject) => {
      console.log('🔍 Checking file size for URL:', url);
      const request = https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          console.log('🔄 Following redirect to:', response.headers.location);
          return this.getFileSize(response.headers.location)
            .then(resolve)
            .catch(reject);
        }
        const contentLength = response.headers['content-length'];
        resolve(contentLength ? parseInt(contentLength, 10) : null);
      });
      request.on('error', reject);
      request.setTimeout(120000, () => {
        request.destroy();
        resolve(null);
      });
    });
  },

  formatSpeed: (bytesPerSecond) => {
    const units = ["B/s", "KB/s", "MB/s", "GB/s"];
    let speed = bytesPerSecond;
    let unitIndex = 0;
    while (speed >= 1024 && unitIndex < units.length - 1) {
      speed /= 1024;
      unitIndex++;
    }
    return `${speed.toFixed(1)} ${units[unitIndex]}`;
  },

  withRetry: async (fn, retries = 3, delayMs = 1000) => {
    try {
      return await fn();
    } catch (error) {
      if (retries <= 0) throw error;
      await this.delay(delayMs);
      return this.withRetry(fn, retries - 1, delayMs * 2);
    }
  },

  sanitizeMetadata: (doc) => ({
    title: String(doc.title || "").trim(),
    language: String(doc.language || "").trim(),
    originalLanguage: String(doc.originalLanguage || "").trim(),
    runtime: String(doc.runtime || "").trim(),
    genres: Array.isArray(doc.genres) ? 
      doc.genres.filter(Boolean).map(String) : 
      []
  }),

  // Export new file utilities
  safeWrite,
  safeDelete,
  cleanupTempDirs
};
