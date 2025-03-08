import { connect } from "puppeteer-real-browser";
import { processAllPosts, closeConnection } from './db.js';
import { downloadVideo } from './aria2.js';
import https from 'https';
import os from 'os';
import path from 'path';
import fs from 'fs';

/**
 * Gets the file size of a remote URL
 * @param {string} url - URL to check
 * @returns {Promise<number|null>} File size in bytes or null if size cannot be determined
 */
function getFileSize(url) {
  return new Promise((resolve, reject) => {
    console.log('🔍 Checking file size for URL:', url);
    
    const request = https.get(url, (response) => {
      console.log('📨 Response headers:', response.headers);
      console.log('📊 Response status code:', response.statusCode);
      
      // Handle redirects
      if (response.statusCode === 302 || response.statusCode === 301) {
        console.log('🔄 Following redirect to:', response.headers.location);
        return getFileSize(response.headers.location)
          .then(resolve)
          .catch(reject);
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP status code ${response.statusCode}`));
        return;
      }
      
      const contentLength = response.headers['content-length'];
      if (!contentLength) {
        console.log('⚠️ No content-length header found in response');
        // Instead of rejecting, resolve with null to continue download
        resolve(null);
        return;
      }
      
      const size = parseInt(contentLength, 10);
      const sizeInMB = (size / (1024 * 1024)).toFixed(2);
      console.log(`📦 File size: ${sizeInMB} MB`);
      resolve(size);
    });

    request.on('error', (error) => {
      console.error('❌ Error during size check:', error.message);
      resolve(null);
    });

    request.setTimeout(120000, () => {
      console.log('⚠️ Size check timeout after 120s for URL:', url);
      request.destroy();
      resolve(null);
    });

    request.end();
  });
}

/**
 * Waits for a random duration between min and max milliseconds
 * @param {number} min - Minimum wait time in milliseconds
 * @param {number} max - Maximum wait time in milliseconds
 * @returns {Promise<void>}
 */
function waitRandom(min, max) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Processes a URL to extract video download link and handle upload
 * @param {string} url - URL to process
 * @param {Object} doc - Document metadata
 * @param {string} resolution - Video resolution
 * @param {number} retryAttempt - Current retry attempt number
 * @returns {Promise<string|Object>} Video URL or skip result object
 */
async function processUrl(url, doc, resolution, retryAttempt = 0) {
  const maxRetries = 2;
  let browser, page;
  let tempDir = null;

  try {
    tempDir = path.join(os.tmpdir(), `chrome-data-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const connection = await connect({
      headless: false,
      turnstile: true,
      disableXvfb: false,
      defaultViewport: null,
    });
    browser = connection.browser;
    page = connection.page;
    
    page.setDefaultNavigationTimeout(0);
    page.setDefaultTimeout(120000);
    page.setJavaScriptEnabled(true);
    page.setBypassCSP(true);
    
    page.on('popup', async popup => {
      const popupUrl = popup.url();
      if (!popupUrl.includes('download') && !popupUrl.includes('cloudflare')) {
        await popup.close();
        console.log('🚫 Blocked non-essential popup:', popupUrl);
      } else {
        console.log('🔵 Allowing download-related popup:', popupUrl);
      }
    });
    
    await page.evaluateOnNewDocument(() => {
      window.open = function() {};
      window.alert = function() {};
      window.confirm = function() { return true; };
      window.prompt = function() { return null; };
      Event.prototype.stopPropagation = function() {};
    });
    
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 120000
    });
    
    console.log('🟠 Waiting for Cloudflare Turnstile captcha to be solved...');
    await page.waitForFunction(() => {
      const input = document.querySelector('input[name="cf-turnstile-response"]');
      return input && input.value && input.value.trim().length > 30;
    }, { timeout: 300000 });
    
    await waitRandom(1000, 3000);
    console.log('🟢 Captcha solved! Initiating download...');
    
    let targetFrame = null;
    for (const frame of page.frames()) {
      try {
        await frame.waitForSelector('#download-button', { timeout: 15000 });
        targetFrame = frame;
        break;
      } catch (err) {
        // Continue to next frame
      }
    }
    
    if (!targetFrame) {
      throw new Error("Could not find frame with #download-button");
    }

    await Promise.all([
      page.waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: 60000
      }),
      targetFrame.evaluate(() => {
        const btn = document.querySelector('#download-button');
        if (btn) btn.click();
      })
    ]);

    await page.waitForFunction(() => {
      const el = document.querySelector('#vd');
      return el && el.offsetHeight > 0 && el.href && el.href.length > 100;
    }, { timeout: 120000, polling: 'raf' });
    
    const videoUrl = await page.$eval('#vd', el => el.href);
    
    try {
        const sizeInBytes = await getFileSize(videoUrl);
        const sizeInGB = sizeInBytes / (1024 * 1024 * 1024);
        
        if (sizeInGB > 2) {
            console.log('⚠️ File size exceeds 2GB limit:', sizeInGB.toFixed(2), 'GB');
            return {
                skipped: true,
                reason: `File size (${sizeInGB.toFixed(2)}GB) exceeds 2GB limit`,
                url: videoUrl
            };
        }

        console.log('✅ Verified download URL:', videoUrl);
        const downloadResult = await downloadVideo(videoUrl, process.env.ARIA2_DOWNLOAD_DIR, {
            ...doc,
            resolution: resolution,
            Movie: doc.title,
            Language: doc.language,
            'Original Language': doc.originalLanguage,
            Runtime: doc.runtime,
            Genres: doc.genres?.join(', ')
        });
        
        if (!downloadResult.success) {
            console.error('❌ Download failed:', downloadResult.reason);
            return {
                skipped: true,
                reason: downloadResult.reason,
                url: videoUrl
            };
        }
        
        console.log('Aria2 download result:', downloadResult);
        return videoUrl;

    } catch (error) {
        console.error('❌ File size check failed:', error.message);
        console.log('⚠️ Skipping download due to size verification failure');
        return {
            skipped: true,
            reason: 'Size verification failed - skipped for safety',
            url: videoUrl
        };
    }
  } catch (error) {
    console.error('❌ Critical error:', error);
    if (retryAttempt < maxRetries) {
      console.log(`Retrying... Attempt ${retryAttempt + 1} of ${maxRetries}`);
      return processUrl(url, doc, resolution, retryAttempt + 1);
    }
    return {
        skipped: true,
        reason: `Failed after ${maxRetries + 1} attempts: ${error.message}`,
        url: url
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (err) {
        console.log('Browser close error:', err.message);
      }
    }
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (e) {
        console.log('Failed to clean up temp directory:', e.message);
      }
    }
  }
}

// Create required directories
['./chrome-data', './chrome-data/temp'].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o777 });
    }
});

processAllPosts(processUrl)
  .then(() => {
    console.log('All posts processed successfully.');
    return closeConnection();
  })
  .catch(err => {
    console.error('Error during post processing:', err);
    return closeConnection();
  });
