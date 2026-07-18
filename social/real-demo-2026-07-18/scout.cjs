// Scout: mobile screenshots of the live pages to plan the reel shots.
//   node scout.cjs
const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DIR = __dirname;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--hide-scrollbars', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 693, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');

  // pre-set consent so the banner never shows
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('velyr_consent', JSON.stringify({ accepted: true, ts: Date.now() })); } catch {}
    try { localStorage.setItem('velyr_consent', 'accepted'); } catch {}
  });

  for (const [name, url] of [
    ['home', 'https://velyr.io/'],
    ['timeline', 'https://velyr.io/agent/velyr'],
  ]) {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: path.join(DIR, 'check', `scout-${name}-top.png`) });
    // full page for shot planning
    await page.screenshot({ path: path.join(DIR, 'check', `scout-${name}-full.png`), fullPage: true });
    const h = await page.evaluate(() => document.body.scrollHeight);
    console.log(name, 'scrollHeight(css)=', h);
  }
  await browser.close();
})();
