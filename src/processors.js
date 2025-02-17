const { downloadVideo } = require('./aria2');
const { delay, getFileSize, waitRandom } = require('./utils');
const browserManager = require('./utils/browser');

async function processUrl(url, doc, resolution, retryAttempt = 0) {
    const maxRetries = 2;
    let browserInstance;
    try {
      console.log(`[Processors] Creating browser instance...`);
      browserInstance = await browserManager.createBrowserInstance();
      const page = browserInstance.page;
      
      console.log(`[Processors] Configuring page...`);
      await browserManager.configurePage(page);
  
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
      let targetFrame = null;
      const frames = await page.frames();
      
      // First try: Look for frame with download button
      for (const frame of frames) {
        try {
          const hasButton = await frame.evaluate(() => {
            const btn = document.querySelector('#download-button');
            return btn && btn.offsetParent !== null; // Check if button is visible
          });
          
          if (hasButton) {
            targetFrame = frame;
            break;
          }
        } catch (err) {
          continue; // Skip frames that can't be evaluated
        }
      }
      // Verify frame is accessible and has required elements
      try {
        await targetFrame.waitForSelector('#download-button', {
          visible: true,
          timeout: 15000
        });
      } catch (error) {
        throw new Error(`Download button not found in frame: ${error.message}`);
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
