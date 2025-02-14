const Aria2 = require('aria2');
const aria2 = new Aria2({
  host: 'localhost',
  port: 6800,
  secure: false,
  secret: '',
  path: '/jsonrpc'
});
async function downloadVideo(url, dir = './downloads') {
  try {
    await aria2.open();
    console.log('Aria2 connection opened.');
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid download URL.');
    }
    console.log('Attempting to download:', url);
    const options = {
      dir: dir,
      split: '8',
      maxConnectionPerServer: '8',
      'continue': 'true'
    };
    const guid = await aria2.call('addUri', [url], options);
    console.log('Aria2 download started:', guid);
    await aria2.close();
    return { success: true, guid };
  } catch (error) {
    console.error('Aria2 RPC error:', error.message);
    console.error('Full error:', error);
    await aria2.close();
    return { skipped: true, reason: `Aria2 RPC failed: ${error.message}` };
  }
}
module.exports = { downloadVideo };
