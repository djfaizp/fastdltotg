# Changes Required for downloadWorker.js

## Replace Puppeteer with Puppeteer-Real-Browser

### 1. Update Imports
Replace:
```javascript
const puppeteer = require('puppeteer');
```

With:
```javascript
const { connect } = require('puppeteer-real-browser');
```

### 2. Modify Browser Initialization
Replace:
```javascript
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
```

With:
```javascript
const connection = await connect({
  headless: false,
  turnstile: true,
  disableXvfb: false,
  defaultViewport: null
});
const browser = connection.browser;
const page = connection.page;
```

### 3. Update Browser Cleanup
Replace:
```javascript
await browser.close();
```

With:
```javascript
await connection.close();
```

### 4. Pass Browser to processUrl
Update the processUrl call to include the browser instance:
```javascript
updates.directUrls[res] = await processUrl(doc[res], doc, res, browser);
```

## Instructions
1. Open src/workers/downloadWorker.js
2. Make the changes as outlined above
3. Save the file
4. Test the changes to ensure proper functionality