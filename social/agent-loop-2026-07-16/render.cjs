// Frame-by-frame renderer: drives scene.html's deterministic window.__seek(t)
// and shoots one PNG per frame with a single Chrome instance.
//   node render.js
// Replaces the old "one chrome launch per static slide + ffmpeg zoompan" approach
// (that look = slideshow; the 2026-07-16 insights pull says slideshows don't hold watch time).
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const FPS = 30;
const DIR = __dirname;
const OUT = path.join(DIR, 'png');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, f));

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--force-device-scale-factor=1', '--hide-scrollbars', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });

  const url = 'file:///' + path.join(DIR, 'scene.html').replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__ready === true', { timeout: 30000 });

  const duration = await page.evaluate(() => window.__duration);
  const total = Math.round(duration * FPS);
  console.log(`rendering ${total} frames (${duration}s @ ${FPS}fps)`);

  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    await page.evaluate((tt) => window.__seek(tt), t);
    const file = path.join(OUT, 'f-' + String(i).padStart(4, '0') + '.png');
    await page.screenshot({ path: file });
    if (i % 30 === 0) process.stdout.write(`  ${i}/${total} (t=${t.toFixed(1)}s)\n`);
  }

  await browser.close();
  console.log(`done: ${total} frames in png/`);
})().catch((e) => { console.error(e); process.exit(1); });
