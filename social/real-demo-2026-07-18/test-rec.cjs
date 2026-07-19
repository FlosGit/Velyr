// Resolution test: does page.screencast() deliver device-pixel (1080x1920) frames
// with viewport 390x693 @ DSF 2.769?
const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--hide-scrollbars', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 693, deviceScaleFactor: 2.769, isMobile: true, hasTouch: true });
  await page.goto('https://velyr.io/', { waitUntil: 'networkidle2', timeout: 60000 });
  const rec = await page.screencast({ path: path.join(__dirname, 'rec', 'test.webm') });
  await page.evaluate(() => new Promise(r => {
    const start = performance.now();
    (function step(){ const t = (performance.now()-start)/2000; window.scrollTo(0, t*800); t<1 ? requestAnimationFrame(step) : r(); })();
  }));
  await rec.stop();
  await browser.close();
})();
