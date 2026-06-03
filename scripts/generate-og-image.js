import { createCanvas } from 'canvas'
import { writeFileSync, rmSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const W = 1200
const H = 630
const canvas = createCanvas(W, H)
const ctx = canvas.getContext('2d')

// ── Background ────────────────────────────────────────────────────────────────
ctx.fillStyle = '#f7f4ef'
ctx.fillRect(0, 0, W, H)

// ── Logo icon (draws the 32×32 SVG viewBox scaled to ICON_SIZE) ───────────────
const ICON = 60
const S = ICON / 32         // scale factor: 1.875
const GREEN = '#2a5c45'

// Measure "Velyr" text width so we can properly center the whole wordmark group
ctx.font = '72px Georgia, serif'
const velyrMetrics = ctx.measureText('Velyr')
const velyrW = velyrMetrics.width

const GAP = 24              // gap between icon and text
const GROUP_W = ICON + GAP + velyrW
const groupX = (W - GROUP_W) / 2  // left edge of the centered group
const groupCY = H / 2 - 30        // vertical center of the group, slightly above canvas center

// Draw icon at (groupX, groupCY - ICON/2)
const ix = groupX
const iy = groupCY - ICON / 2

ctx.save()
ctx.translate(ix, iy)
ctx.scale(S, S)

// outer ring  opacity 0.35
ctx.beginPath()
ctx.arc(16, 16, 14, 0, Math.PI * 2)
ctx.strokeStyle = 'rgba(42,92,69,0.35)'
ctx.lineWidth = 1.1 / S    // keep stroke visually thin after scaling
ctx.stroke()

// inner ring  opacity 0.6
ctx.beginPath()
ctx.arc(16, 16, 9, 0, Math.PI * 2)
ctx.strokeStyle = 'rgba(42,92,69,0.6)'
ctx.lineWidth = 1.1 / S
ctx.stroke()

// center dot
ctx.beginPath()
ctx.arc(16, 16, 3.2, 0, Math.PI * 2)
ctx.fillStyle = GREEN
ctx.fill()

// 4 tick marks  opacity 0.45
const ticks = [
  [16, 2,  16, 7 ],
  [16, 25, 16, 30],
  [2,  16, 7,  16],
  [25, 16, 30, 16],
]
ctx.strokeStyle = 'rgba(42,92,69,0.45)'
ctx.lineWidth = 1.1 / S
ctx.lineCap = 'round'
for (const [x1, y1, x2, y2] of ticks) {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

ctx.restore()

// ── "Velyr" wordmark ──────────────────────────────────────────────────────────
ctx.font = '72px Georgia, serif'
ctx.fillStyle = '#1c1917'
ctx.textBaseline = 'middle'
ctx.textAlign = 'left'
ctx.fillText('Velyr', groupX + ICON + GAP, groupCY)

// ── Separator line ────────────────────────────────────────────────────────────
const lineY = groupCY + 52
const LINE_W = Math.min(GROUP_W, 320)
const lineX = (W - LINE_W) / 2

ctx.strokeStyle = 'rgba(42,92,69,0.3)'
ctx.lineWidth = 1
ctx.lineCap = 'butt'
ctx.beginPath()
ctx.moveTo(lineX, lineY)
ctx.lineTo(lineX + LINE_W, lineY)
ctx.stroke()

// ── Tagline ───────────────────────────────────────────────────────────────────
ctx.font = '28px Arial, sans-serif'
ctx.fillStyle = '#6b6460'
ctx.textBaseline = 'top'
ctx.textAlign = 'center'
ctx.fillText('AI Growth Agent for React, Next.js & Vite', W / 2, lineY + 20)

// ── velyr.io  bottom-right ────────────────────────────────────────────────────
ctx.font = '18px Arial, sans-serif'
ctx.fillStyle = '#a09890'
ctx.textBaseline = 'alphabetic'
ctx.textAlign = 'right'
ctx.fillText('velyr.io', W - 52, H - 40)

// ── Write PNG ─────────────────────────────────────────────────────────────────
const outPath = join(__dirname, '../public/og-image.png')
writeFileSync(outPath, canvas.toBuffer('image/png'))
console.log(`✓ Generated public/og-image.png  (${W}×${H}px)`)

// Remove placeholder if it exists
const placeholderPath = join(__dirname, '../public/OG_IMAGE_MISSING.md')
if (existsSync(placeholderPath)) {
  rmSync(placeholderPath)
  console.log('✓ Removed public/OG_IMAGE_MISSING.md')
}
