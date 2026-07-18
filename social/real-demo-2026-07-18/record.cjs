// Deterministic frame-by-frame capture of the LIVE site (timesnap technique):
// page loads with REAL time; then rAF/performance.now/Date.now switch to a
// virtual clock advanced exactly 1/30s per captured frame (window.__tick).
// Scroll position is scripted per frame -> buttery 30fps motion, sharp
// device-pixel screenshots (viewport 390x693 @ DSF 2.769 = 1080x1919).
// CSS transitions stay wall-clock (reveals pop fast) - acceptable at reel pace.
//   node record.cjs <sceneName>   (or no arg = all scenes)
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FPS = 30;
const DIR = __dirname;

const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

// y: css px, or 'find:<text>[,+extra]' -> first element containing <text> at ~18% from top
const SCENES = {
  // S1 "My website was leaking sales..." - hero, hold then slow drift
  hero: {
    url: 'https://velyr.io/',
    duration: 3.4,
    keys: [ { t: 0, y: 0 }, { t: 1.1, y: 0 }, { t: 3.4, y: 300 } ],
  },
  // S2 "So I gave an AI my code." - step 02 card (writes the code change / PR)
  code: {
    url: 'https://velyr.io/',
    duration: 2.4,
    keys: [
      { t: 0, y: 'find:It writes the code change,-160' },
      { t: 2.4, y: 'find:It writes the code change,+60' },
    ],
  },
  // S3 "Every Monday it finds the biggest leak..." - real leak card on the public timeline
  leak: {
    url: 'https://velyr.io/agent/velyr',
    duration: 3.8,
    keys: [
      { t: 0, y: 'find:Cookie banner obscures,+110' },
      { t: 1.2, y: 'find:Cookie banner obscures,+130' },
      { t: 3.8, y: 'find:Cookie banner obscures,+700' },
    ],
  },
  // S4 "I reply YES - it ships." - real Deployed card on the public timeline
  approve: {
    url: 'https://velyr.io/agent/velyr',
    duration: 2.6,
    keys: [
      { t: 0, y: 'find:Win badge added,-95' },
      { t: 2.6, y: 'find:Win badge added,+200' },
    ],
  },
  // S5 "Numbers drop? One YES rolls it back." - real Rolled Back card (no price text)
  rollback: {
    url: 'https://velyr.io/agent/velyr',
    duration: 2.6,
    keys: [
      { t: 0, y: 'find:The mobile hero CTA,-150' },
      { t: 2.6, y: 'find:The mobile hero CTA,+170' },
    ],
  },
  // S6 end card - the real black CTA card at the timeline bottom
  cta: {
    url: 'https://velyr.io/agent/velyr',
    duration: 2.4,
    keys: [
      { t: 0, y: 'find:Want this for your website,-200' },
      { t: 2.4, y: 'find:Want this for your website,-140' },
    ],
  },
};

(async () => {
  const only = process.argv[2];
  const names = only ? [only] : Object.keys(SCENES);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--hide-scrollbars', '--font-render-hinting=none', '--disable-lcd-text'],
  });

  for (const name of names) {
    const sc = SCENES[name];
    const outDir = path.join(DIR, 'png', name);
    fs.mkdirSync(outDir, { recursive: true });
    for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));

    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 693, deviceScaleFactor: 2.769, isMobile: true, hasTouch: true });
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    await page.evaluateOnNewDocument(() => {
      try { localStorage.setItem('velyr_consent', 'accepted'); } catch {}
      try { localStorage.setItem('velyr_consent', JSON.stringify({ accepted: true, ts: Date.now() })); } catch {}
      // --- virtual clock (armed later via __goVirtual) ---
      const realRaf = window.requestAnimationFrame.bind(window);
      const realNow = performance.now.bind(performance);
      const realDateNow = Date.now.bind(Date);
      let virtual = false, vt = 0, epoch = 0, rafQ = [], rafId = 1;
      window.requestAnimationFrame = (cb) => {
        if (!virtual) return realRaf(cb);
        const id = rafId++; rafQ.push([id, cb]); return id;
      };
      window.cancelAnimationFrame = (id) => { rafQ = rafQ.filter(([i]) => i !== id); };
      performance.now = () => virtual ? vt : realNow();
      Date.now = () => virtual ? Math.round(epoch + vt) : realDateNow();
      window.__goVirtual = () => { vt = realNow(); epoch = realDateNow() - vt; virtual = true; };
      window.__tick = (dt) => {
        vt += dt;
        const q = rafQ; rafQ = [];
        for (const [, cb] of q) { try { cb(vt); } catch {} }
      };
    });

    await page.goto(sc.url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2500));

    // resolve 'find:' anchors
    const keys = [];
    for (const k of sc.keys) {
      let y = k.y;
      if (typeof y === 'string' && y.startsWith('find:')) {
        const [txt, extraRaw] = y.slice(5).split(',');
        const extra = extraRaw ? parseInt(extraRaw, 10) : 0;
        y = await page.evaluate((needle) => {
          const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let n; while ((n = walk.nextNode())) {
            if (n.textContent.includes(needle)) {
              const r = n.parentElement.getBoundingClientRect();
              return Math.max(0, Math.round(r.top + window.scrollY - window.innerHeight * 0.18));
            }
          }
          return -1;
        }, txt);
        if (y < 0) throw new Error(`scene ${name}: text not found: ${txt}`);
        y = Math.max(0, y + extra);
      }
      keys.push({ t: k.t, y });
    }
    console.log(`[${name}] keys: ${JSON.stringify(keys)}`);

    // pre-visit the deepest scroll point so reveal-observers fire BEFORE capture,
    // then return to start and settle
    const maxY = Math.max(...keys.map(k => k.y));
    await page.evaluate((yy) => window.scrollTo(0, yy), maxY + 400);
    await new Promise(r => setTimeout(r, 1200));
    await page.evaluate((yy) => window.scrollTo(0, yy), keys[0].y);
    await new Promise(r => setTimeout(r, 900));

    await page.evaluate(() => window.__goVirtual());

    const yAt = (t) => {
      if (t <= keys[0].t) return keys[0].y;
      for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i], b = keys[i + 1];
        if (t >= a.t && t <= b.t) {
          const p = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
          return Math.round(a.y + (b.y - a.y) * easeInOut(p));
        }
      }
      return keys[keys.length - 1].y;
    };

    const total = Math.round(sc.duration * FPS);
    for (let i = 0; i < total; i++) {
      await page.evaluate((yy, dt) => { window.scrollTo(0, yy); window.__tick(dt); }, yAt(i / FPS), 1000 / FPS);
      await page.screenshot({ path: path.join(outDir, 'f-' + String(i).padStart(4, '0') + '.png') });
      if (i % 30 === 0) console.log(`  [${name}] ${i}/${total}`);
    }
    await page.close();
    console.log(`[${name}] done: ${total} frames`);
  }
  await browser.close();
})();
