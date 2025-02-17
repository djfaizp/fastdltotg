const { downloadVideo } = require('./aria2');
const { delay } = require('./utils');
const { getFileSize } = require('./utils');
const { waitRandom } = require('./utils');  // Added missing import
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { connect } = require('puppeteer-real-browser');

async function processUrl(url, doc, resolution, retryAttempt = 0) {
    const maxRetries = 2;
    let browser, page;
    let tempDir = null;
    try {
      console.log(`[Processors] Creating temporary directory for browser data...`);
      tempDir = path.join(os.tmpdir(), `chrome-data-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });
      
      console.log(`[Processors] Connecting to browser...`);
      const connection = await connect({
        headless: false,
        turnstile: true,
        disableXvfb: false,
        defaultViewport: null,
      });
      browser = connection.browser;
      page = connection.page;
      
      console.log(`[Processors] Setting page timeouts and enabling JS...`);
      await page.setDefaultNavigationTimeout(0);
      await page.setDefaultTimeout(120000);
      await page.setJavaScriptEnabled(true);
      await page.setBypassCSP(true);
  
      page.on('popup', async popup => {
        const popupUrl = popup.url();
        if (!popupUrl.includes('download') && !popupUrl.includes('cloudflare')) {
          console.log(`[Processors] Blocked non-essential popup: ${popupUrl}`);
          await popup.close();
        }
      });
  
      await page.evaluateOnNewDocument(() => {
        window.open = function() {};
        window.alert = function() {};
        window.confirm = function() { return true; };
        window.prompt = function() { return null; };
        Event.prototype.stopPropagation = function() {};
      });
  
      console.log(`[Processors] Navigating to URL: ${url}`);
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 120000
      });
  
      console.log(`[Processors] Waiting for Cloudflare Turnstile captcha to be solved...`);
      await page.waitForFunction(() => {
        const input = document.querySelector('input[name="cf-turnstile-response"]');
        return input?.value?.trim().length > 30;
      }, {
        timeout: 600000,
        polling: 'raf'
      });
  
      console.log(`[Processors] Captcha solved, waiting a random period before download...`);
      await waitRandom(1000, 3000);
  
      console.log(`[Processors] Looking for download frame...`);
      const frames = await page.frames();
      const targetFrame = frames.find(frame =>
        frame.url().includes('download') || frame.url().includes('video')
      );
      if (!targetFrame) {
        throw new Error("Could not find download frame");
      }
  
      console.log(`[Processors] Found download frame, clicking download button...`);
      const [response] = await Promise.all([
        page.waitForNavigation({
          waitUntil: 'domcontentloaded',
          timeout: 60000
        }),
        targetFrame.click('#download-button')
      ]);
  
      console.log(`[Processors] Waiting for direct URL to become available...`);
      await page.waitForFunction(() => {
        const el = document.querySelector('#vd');
        return el?.href?.length > 100;
      }, { timeout: 120000, polling: 'raf' });
      
      const videoUrl = await page.$eval('#vd', el => el.href);
      console.log(`[Processors] Successfully retrieved direct URL: ${videoUrl}`);
      return videoUrl;
    } catch (error) {
      console.error('[Processors] Processing error:', error);
      if (retryAttempt < maxRetries) {
        console.log(`[Processors] Retrying... Attempt ${retryAttempt + 1} of ${maxRetries}`);
        return processUrl(url, doc, resolution, retryAttempt + 1);
      }
      throw error;
    } finally {
      if (browser) {
        console.log(`[Processors] Closing browser...`);
        await browser.close().catch(console.error);
      }
      if (tempDir) {
        console.log(`[Processors] Removing temporary directory...`);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }
  
module.exports = {
    processUrl
};