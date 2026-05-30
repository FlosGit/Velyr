import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = process.env.SHOT_URL || 'http://localhost:4173/'
const OUT = 'C:\\Users\\flori\\Velyr\\shots'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
})

async function dismissCookie(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /accept/i.test(x.textContent || ''))
    if (b) b.click()
  })
  await sleep(250)
}

// ── 1. REDUCED MOTION: load, jump straight to deep sections WITHOUT a scroll
//      walk. If content is visible, the static fallback works (no observer dep).
{
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 })
  await dismissCookie(page)
  // Jump directly — no incremental scroll — to prove reveals aren't gated on it.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.62))
  await sleep(500)
  await page.screenshot({ path: `${OUT}\\rm_deep.jpg`, type: 'jpeg', quality: 82 })
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.42))
  await sleep(400)
  await page.screenshot({ path: `${OUT}\\rm_mid.jpg`, type: 'jpeg', quality: 82 })
  await page.close()
}

// ── 2. NORMAL MOTION: hover a differentiator card (lift) + tab fade sanity.
{
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 })
  await dismissCookie(page)
  await page.evaluate(() => { const h=document.body.scrollHeight; for(let y=0;y<=h;y+=400) window.scrollTo(0,y); window.scrollTo(0,0) })
  await sleep(500)

  // Hover a differentiator card and capture the lifted state.
  await page.evaluate(() => {
    const el = document.querySelector('.diff-grid')
    if (el) el.scrollIntoView({ block: 'center' })
  })
  await sleep(500)
  const card = await page.$('.diff-grid .lift')
  if (card) { await card.hover(); await sleep(350); await page.screenshot({ path: `${OUT}\\hover_card.jpg`, type: 'jpeg', quality: 82 }) }

  // Network tab (confirms keyed fade target renders).
  await page.evaluate(() => { const el = document.querySelector('.dash-preview-shell'); if (el) el.scrollIntoView({ block:'center' }) })
  await sleep(500)
  await page.evaluate(() => {
    const nav = document.querySelector('.dash-preview-shell .dp-leftnav nav')
    const item = nav && [...nav.children].find(d => d.textContent.replace(/\s+/g,'').includes('Network'))
    if (item) item.click()
  })
  await sleep(1400)
  const shell = await page.$('.dash-preview-shell')
  if (shell) await shell.screenshot({ path: `${OUT}\\tab_network.jpg`, type: 'jpeg', quality: 82 })
  await page.close()
}

await browser.close()
console.log('done')
