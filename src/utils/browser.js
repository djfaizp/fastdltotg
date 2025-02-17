const { connect } = require('puppeteer-real-browser');
const fs = require('fs');
const os = require('os');
const path = require('path');

class BrowserManager {
  constructor() {
    this.defaultConfig = {
      headless: false,
      turnstile: true,
      disableXvfb: false,
      defaultViewport: null
    };
  }

  async createBrowserInstance() {
    const tempDir = path.join(os.tmpdir(), `chrome-data-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const connection = await connect(this.defaultConfig);
    return {
      browser: connection.browser,
      page: connection.page,
      tempDir
    };
  }

  async closeBrowserInstance(browserInstance) {
    try {
      if (browserInstance.browser) {
        await browserInstance.browser.close();
      }
      if (browserInstance.tempDir) {
        fs.rmSync(browserInstance.tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.error('Error closing browser instance:', error);
    }
  }

  async configurePage(page) {
    await page.setDefaultNavigationTimeout(0);
    await page.setDefaultTimeout(120000);
    await page.setJavaScriptEnabled(true);
    await page.setBypassCSP(true);

    page.on('popup', async popup => {
      const popupUrl = popup.url();
      if (!popupUrl.includes('download') && !popupUrl.includes('cloudflare')) {
        console.log(`Blocked non-essential popup: ${popupUrl}`);
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
  }
}

module.exports = new BrowserManager();