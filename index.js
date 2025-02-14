const { connect } = require("puppeteer-real-browser");
const { processAllPosts, closeConnection } = require('./db');
const { downloadVideo } = require('./aria2');
function waitRandom(min, max) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
}
async function processUrl(url, retryAttempt = 0) {
  const maxRetries = 2;
  let browser, page;
  try {
    const connection = await connect({
      headless: false,
      connectOption: { defaultViewport: null },
      turnstile: true,
      disableXvfb: false
    });
    browser = connection.browser;
    page = connection.page;
    await page.setDefaultNavigationTimeout(0);
    await page.setDefaultTimeout(120000);
    await page.setJavaScriptEnabled(true);
    await page.setBypassCSP(true);
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
      }
    }
    if (!targetFrame) {
      throw new Error("Could not find frame with #download-button");
    }
    const [response] = await Promise.all([
      page.waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: 60000
      }),
      targetFrame.evaluate(() => {
        const btn = document.querySelector('#download-button');
        if (btn) {
          btn.click();
        }
      })
    ]);
    await page.waitForFunction(() => {
      const el = document.querySelector('#vd');
      return el && el.offsetHeight > 0 && el.href && el.href.length > 100;
    }, { timeout: 120000, polling: 'raf' });
    const videoUrl = await page.$eval('#vd', el => el.href);
    console.log('✅ Verified download URL:', videoUrl);
    const downloadResult = await downloadVideo(videoUrl);
    console.log('Aria2 download result:', downloadResult);
    return videoUrl;
  } catch (error) {
    console.error('❌ Critical error:', error);
    if (page) {
      const screenshotPath = `error-screenshot-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath });
      console.log('Screenshot saved as:', screenshotPath);
    }
    if (retryAttempt < maxRetries) {
      console.log(`Retrying... Attempt ${retryAttempt + 1} of ${maxRetries}`);
      return processUrl(url, retryAttempt + 1);
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
processAllPosts(processUrl)
  .then(() => {
    console.log('All posts processed successfully.');
    return closeConnection();
  })
  .catch(err => {
    console.error('Error during post processing:', err);
    return closeConnection();
  });
