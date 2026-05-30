import puppeteer from 'puppeteer-core'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = 'http://localhost:4173/'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })

// ── Reduced motion: deep content must be fully visible WITHOUT scrolling ──────
const rm = await browser.newPage()
await rm.setViewport({ width: 1280, height: 900 })
await rm.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
await rm.goto(URL, { waitUntil: 'networkidle0' })
await sleep(400)
const rmCheck = await rm.evaluate(() => {
  const out = {}
  const cards = [...document.querySelectorAll('.diff-grid .lift, .reveal')]
  // Min opacity across reveal-driven elements while still at top of page.
  let min = 1
  for (const el of document.querySelectorAll('.reveal')) {
    min = Math.min(min, parseFloat(getComputedStyle(el).opacity))
  }
  out.minRevealOpacity = min
  // A specific deep card (differentiator) opacity + its wrapper.
  const diff = document.querySelector('.diff-grid > div')
  out.diffWrapperOpacity = diff ? parseFloat(getComputedStyle(diff).opacity) : null
  const lift = document.querySelector('.diff-grid .lift')
  out.liftTransitionDuration = lift ? getComputedStyle(lift).transitionDuration : null
  out.htmlScrollBehavior = getComputedStyle(document.documentElement).scrollBehavior
  return out
})
console.log('REDUCED-MOTION:', JSON.stringify(rmCheck))
await rm.close()

// ── Normal motion: reveal settles to opacity 1; hover lift transform applies ──
const nm = await browser.newPage()
await nm.setViewport({ width: 1280, height: 900 })
await nm.goto(URL, { waitUntil: 'networkidle0' })
await nm.evaluate(() => { const h=document.body.scrollHeight; for(let y=0;y<=h;y+=300) window.scrollTo(0,y) })
await sleep(900)
await nm.evaluate(() => { const e=document.querySelector('.diff-grid'); if(e) e.scrollIntoView({block:'center'}) })
await sleep(700)
const nmCheck = await nm.evaluate(async () => {
  const lift = document.querySelector('.diff-grid .lift')
  const before = getComputedStyle(lift).transform
  lift.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  // Force :hover via puppeteer isn't possible from evaluate; read transition instead.
  return {
    revealSettled: parseFloat(getComputedStyle(document.querySelector('.diff-grid > div')).opacity),
    liftTransition: getComputedStyle(lift).transitionProperty,
    liftTransitionDuration: getComputedStyle(lift).transitionDuration,
    transformBefore: before,
  }
})
// Real hover via the input system to read the lifted transform.
const card = await nm.$('.diff-grid .lift')
await card.hover()
await sleep(350)
const hovered = await nm.evaluate(() => getComputedStyle(document.querySelector('.diff-grid .lift')).transform)
console.log('NORMAL-MOTION:', JSON.stringify({ ...nmCheck, transformHovered: hovered }))
await nm.close()

await browser.close()
console.log('done')
