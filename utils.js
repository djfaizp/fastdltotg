module.exports = {
  delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  waitRandom: (min, max) => {  // Added missing function
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
          await module.exports.delay(delayMs);
          return module.exports.withRetry(fn, retries - 1, delayMs * 2);
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
  })
};