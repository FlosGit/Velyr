# Generates the demo-reel scene HTMLs (1080x1920, IG Reel / YT Short 9:16) into ./scenes/
# Render each with:
#   chrome --headless --screenshot --window-size=1080,1920 --virtual-time-budget=12000 <file>
# Then assemble.sh stitches PNGs -> velyr-demo-short.mp4 with ffmpeg motion.
#
# Design follows the data (see analysis 2026-07-13):
#  - Reel, not carousel (carousels reached 2-3).
#  - Problem-first hook in second 1 (winning reels opened on the viewer's loss).
#  - Recreate the top-performer look: the real Telegram YES -> PR -> rollback flow.
import os, html

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scenes")
os.makedirs(OUT, exist_ok=True)

BASE_CSS = """
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400;1,500&family=Jost:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=block');
* { margin:0; padding:0; box-sizing:border-box; }
body {
  width:1080px; height:1920px; overflow:hidden; position:relative;
  background:#191512; color:#f7f4ef;
  font-family:'Jost',sans-serif; font-weight:300;
  -webkit-font-smoothing:antialiased;
}
body::before {
  content:''; position:absolute; inset:0;
  background:
    radial-gradient(900px 700px at 88% -6%, rgba(125,201,160,0.08), transparent 70%),
    radial-gradient(820px 640px at 4% 106%, rgba(140,115,85,0.10), transparent 70%);
}
.wordmark { position:absolute; top:70px; left:84px; font-family:'Cormorant Garamond',serif; font-weight:500; font-size:44px; letter-spacing:.01em; z-index:5; }
.wordmark::after { content:''; display:inline-block; width:12px; height:12px; border-radius:50%; background:#7dc9a0; margin-left:11px; margin-bottom:3px; }
.step { position:absolute; top:82px; right:84px; font-family:'DM Mono',monospace; font-size:24px; color:#8a8078; letter-spacing:.14em; z-index:5; }
.url { position:absolute; bottom:70px; right:84px; font-size:24px; color:#8a8078; letter-spacing:.08em; z-index:5; }
em { font-style:italic; color:#7dc9a0; font-weight:400; }
"""

def page(title, extra_css, body):
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>{html.escape(title)}</title>
<style>{BASE_CSS}{extra_css}</style></head><body>
{body}
</body></html>"""

def chrome(step):
    return f'<div class="wordmark">Velyr</div><div class="step">{step}</div>'

scenes = {}

# ---------- S1: HOOK (problem-first, the winning pattern) ----------
scenes["1-hook"] = page("hook", """
.hw { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; padding:0 92px; z-index:3; }
.kick { font-family:'DM Mono',monospace; font-size:27px; letter-spacing:.28em; text-transform:uppercase; color:#7dc9a0; margin-bottom:54px; }
.h1 { font-family:'Cormorant Garamond',serif; font-weight:300; font-size:150px; line-height:1.02; letter-spacing:-0.02em; }
.sub { margin-top:64px; font-size:42px; color:#b5aca3; line-height:1.46; max-width:860px; }
""", f"""{chrome('')}
<div class="hw">
  <div class="kick">Every week</div>
  <div class="h1">Your site is <em>leaking signups</em> — and you can't see where.</div>
  <div class="sub">So I gave an AI agent access to my code. Here's what happens.</div>
</div>
<div class="url">velyr.io</div>""")

# ---------- Telegram chat shell ----------
TG_CSS = """
.phone { position:absolute; left:84px; right:84px; top:210px; bottom:200px; z-index:3;
  background:#0f0d0b; border:1px solid rgba(247,244,239,0.10); border-radius:44px; overflow:hidden;
  box-shadow:0 40px 120px rgba(0,0,0,0.55); display:flex; flex-direction:column; }
.tg-head { display:flex; align-items:center; gap:22px; padding:34px 40px; background:#181513; border-bottom:1px solid rgba(247,244,239,0.07); }
.tg-av { width:74px; height:74px; border-radius:50%; background:linear-gradient(150deg,#7dc9a0,#3f6b56); display:flex; align-items:center; justify-content:center; font-family:'Cormorant Garamond',serif; font-weight:500; font-size:42px; color:#0f0d0b; }
.tg-name { font-family:'Jost'; font-weight:500; font-size:38px; }
.tg-name span { display:block; font-size:24px; color:#7dc9a0; font-weight:400; margin-top:4px; }
.tg-body { flex:1; padding:44px 40px; display:flex; flex-direction:column; gap:30px; }
.bubble { max-width:78%; padding:30px 34px; border-radius:30px; font-size:34px; line-height:1.42; }
.bot { align-self:flex-start; background:#221d18; border:1px solid rgba(247,244,239,0.08); border-bottom-left-radius:10px; color:#f2ede7; }
.me  { align-self:flex-end; background:#7dc9a0; color:#12100e; font-weight:500; border-bottom-right-radius:10px; }
.tag { font-family:'DM Mono',monospace; font-size:23px; letter-spacing:.16em; text-transform:uppercase; color:#7dc9a0; margin-bottom:14px; }
.ba { margin-top:24px; display:flex; gap:16px; }
.ba .mini { flex:1; background:#15120f; border:1px solid rgba(247,244,239,0.09); border-radius:16px; padding:18px; }
.ba .mlabel { font-family:'DM Mono',monospace; font-size:19px; color:#8a8078; letter-spacing:.12em; text-transform:uppercase; margin-bottom:14px; }
.ba .sk { height:12px; border-radius:6px; background:rgba(247,244,239,0.14); margin-bottom:12px; }
.ba .sk.w70 { width:70%; } .ba .sk.w45 { width:45%; } .ba .sk.w90 { width:90%; }
.ba .cta-lo { margin-top:44px; height:34px; width:60%; border-radius:8px; background:rgba(224,154,128,0.35); }
.ba .cta-hi { margin-top:12px; height:34px; width:60%; border-radius:8px; background:#7dc9a0; }
.hint { align-self:flex-start; font-family:'DM Mono',monospace; font-size:26px; color:#8a8078; letter-spacing:.04em; margin-top:6px; }
.shipped { align-self:flex-start; background:rgba(125,201,160,0.12); border:1px solid rgba(125,201,160,0.4); color:#9fd8ba; padding:24px 30px; border-radius:24px; font-family:'DM Mono',monospace; font-size:28px; letter-spacing:.02em; }
"""

def tg_head():
    return """<div class="tg-head"><div class="tg-av">V</div>
      <div class="tg-name">Velyr agent<span>bot · online</span></div></div>"""

BOT_MSG = """<div class="bubble bot">
  <div class="tag">Weekly fix · /pricing</div>
  Your primary CTA sits <b>below the fold on mobile</b>. 61% of visitors never scroll to it.
  <div class="ba">
    <div class="mini"><div class="mlabel">Before</div>
      <div class="sk w90"></div><div class="sk w70"></div><div class="sk w45"></div>
      <div class="cta-lo"></div></div>
    <div class="mini"><div class="mlabel">After</div>
      <div class="sk w90"></div><div class="cta-hi"></div><div class="sk w70"></div>
      <div class="sk w45"></div></div>
  </div>
</div>"""

# ---------- S2: bot proposes the fix ----------
scenes["2-telegram"] = page("telegram", TG_CSS, f"""{chrome('the fix')}
<div class="phone">{tg_head()}
  <div class="tg-body">
    {BOT_MSG}
    <div class="bubble bot" style="max-width:64%;">Reply <b>YES</b> and I'll ship it as a pull request. Nothing goes live without your OK.</div>
  </div>
</div>
<div class="url">velyr.io</div>""")

# ---------- S3: you tap YES -> shipped ----------
scenes["3-yes"] = page("yes", TG_CSS, f"""{chrome('one tap')}
<div class="phone">{tg_head()}
  <div class="tg-body">
    {BOT_MSG}
    <div class="bubble me">YES ✅</div>
    <div class="shipped">↑ shipped · PR #128 merged</div>
  </div>
</div>
<div class="url">velyr.io</div>""")

# ---------- S4: the real PR ----------
scenes["4-pr"] = page("pr", """
.pr { position:absolute; left:84px; right:84px; top:250px; z-index:3;
  background:#141210; border:1px solid rgba(247,244,239,0.10); border-radius:34px; overflow:hidden;
  box-shadow:0 40px 120px rgba(0,0,0,0.5); }
.pr-head { padding:44px 48px 36px; border-bottom:1px solid rgba(247,244,239,0.08); }
.merged { display:inline-flex; align-items:center; gap:14px; background:#8250df; color:#fff; font-family:'Jost'; font-weight:500; font-size:30px; padding:16px 30px; border-radius:99px; }
.merged::before { content:''; width:20px; height:20px; border-radius:50%; background:#fff; box-shadow:0 0 0 6px rgba(255,255,255,0.25); }
.pr-title { margin-top:34px; font-family:'Cormorant Garamond',serif; font-weight:400; font-size:60px; line-height:1.12; }
.pr-meta { margin-top:22px; font-family:'DM Mono',monospace; font-size:26px; color:#8a8078; letter-spacing:.04em; }
.pr-meta b { color:#7dc9a0; font-weight:500; }
.diff { font-family:'DM Mono',monospace; font-size:29px; line-height:2.0; padding:30px 0; }
.dl { display:flex; white-space:pre; padding:0 48px; }
.dl.ctx { color:#8a8078; } .dl.del { background:rgba(224,120,86,0.12); color:#e09a80; }
.dl.add { background:rgba(125,201,160,0.12); color:#9fd8ba; }
.dl .s { width:46px; flex:none; }
.cap { position:absolute; left:84px; right:84px; bottom:230px; z-index:3; text-align:center;
  font-family:'Cormorant Garamond',serif; font-weight:300; font-size:56px; color:#f7f4ef; }
""", f"""{chrome('real code')}
<div class="pr">
  <div class="pr-head">
    <span class="merged">Merged</span>
    <div class="pr-title">Move primary CTA above the fold on mobile</div>
    <div class="pr-meta"><b>velyr-agent</b> merged 1 commit into <b>main</b> · #128</div>
  </div>
  <div class="diff">
    <div class="dl ctx"><span class="s"> </span>&lt;section className="hero"&gt;</div>
    <div class="dl del"><span class="s">−</span>  &lt;p className="blurb"&gt;...&lt;/p&gt;</div>
    <div class="dl add"><span class="s">+</span>  &lt;a href="/signup"&gt;Start free →&lt;/a&gt;</div>
    <div class="dl ctx"><span class="s"> </span>&lt;/section&gt;</div>
  </div>
</div>
<div class="cap">A real pull request. Not a to-do list.</div>
<div class="url">velyr.io</div>""")

# ---------- S5: 48h safety net + rollback ----------
scenes["5-graph"] = page("graph", """
.gwrap { position:absolute; left:84px; right:84px; top:250px; z-index:3;
  background:#141210; border:1px solid rgba(247,244,239,0.10); border-radius:34px; padding:52px 56px;
  box-shadow:0 40px 120px rgba(0,0,0,0.5); }
.glabel { font-family:'DM Mono',monospace; font-size:26px; letter-spacing:.16em; text-transform:uppercase; color:#8a8078; }
.gbig { margin-top:16px; font-family:'Cormorant Garamond',serif; font-weight:300; font-size:88px; color:#7dc9a0; line-height:1; }
.gbig span { font-size:40px; color:#b5aca3; }
svg { display:block; margin-top:40px; width:100%; height:auto; }
.gnote { margin-top:34px; font-size:34px; color:#cfc8c0; line-height:1.5; }
.gnote b { color:#f7f4ef; font-weight:400; }
.cap2 { position:absolute; left:84px; right:84px; bottom:230px; z-index:3; text-align:center;
  font-family:'Jost'; font-weight:300; font-size:40px; color:#b5aca3; line-height:1.5; }
""", f"""{chrome('48h check')}
<div class="gwrap">
  <div class="glabel">Bounce rate · after deploy</div>
  <div class="gbig">−14%<span> in 48h</span></div>
  <svg viewBox="0 0 900 360" preserveAspectRatio="none">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7dc9a0" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#7dc9a0" stop-opacity="0"/></linearGradient></defs>
    <line x1="470" y1="20" x2="470" y2="360" stroke="rgba(247,244,239,0.18)" stroke-width="2" stroke-dasharray="8 10"/>
    <text x="482" y="46" fill="#8a8078" font-family="DM Mono" font-size="22">deploy</text>
    <path d="M0,150 L150,140 L300,158 L470,150 L620,232 L760,286 L900,300 L900,360 L0,360 Z" fill="url(#g)"/>
    <path d="M0,150 L150,140 L300,158 L470,150 L620,232 L760,286 L900,300" fill="none" stroke="#7dc9a0" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="900" cy="300" r="12" fill="#7dc9a0"/>
  </svg>
  <div class="gnote">Velyr measures every fix for <b>48 hours</b>. If one ever hurts your numbers, it <b>proposes a rollback</b>.</div>
</div>
<div class="cap2">You stay in control the whole time.</div>
<div class="url">velyr.io</div>""")

# ---------- S6: closer ----------
scenes["6-close"] = page("close", """
.cw { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; padding:0 96px; z-index:3; }
.ct { font-family:'Cormorant Garamond',serif; font-weight:300; font-size:132px; line-height:1.04; letter-spacing:-0.015em; }
.cb { margin-top:52px; font-size:40px; color:#b5aca3; line-height:1.5; max-width:820px; }
.pill { margin-top:70px; background:#7dc9a0; color:#191512; font-weight:600; font-size:40px; padding:30px 70px; border-radius:99px; letter-spacing:.01em; }
.note { margin-top:34px; font-family:'DM Mono',monospace; font-size:27px; color:#8a8078; letter-spacing:.06em; }
""", f"""{chrome('')}
<div class="cw">
  <div class="ct">One conversion fix. <em>Every week.</em></div>
  <div class="cb">Connect GitHub or Shopify. Approve with one tap. Velyr ships the rest.</div>
  <div class="pill">velyr.io</div>
  <div class="note">14-day free trial · no card</div>
</div>""")

for name, doc in scenes.items():
    p = os.path.join(OUT, f"scene-{name}.html")
    with open(p, "w", encoding="utf-8") as f:
        f.write(doc)
    print("wrote", p)
