# Generates the 7 carousel slide HTMLs (1080x1350, IG 4:5) into ./slides/
# Render with: chrome --headless --screenshot --window-size=1080,1350 --virtual-time-budget=12000 <file>
import os, html

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "slides")
os.makedirs(OUT, exist_ok=True)

BASE_CSS = """
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400;1,500&family=Jost:wght@300;400;500&family=DM+Mono:wght@400;500&display=block');
* { margin:0; padding:0; box-sizing:border-box; }
body {
  width:1080px; height:1350px; overflow:hidden; position:relative;
  background:#191512; color:#f7f4ef;
  font-family:'Jost',sans-serif; font-weight:300;
  -webkit-font-smoothing:antialiased;
}
body::before {
  content:''; position:absolute; inset:0;
  background:
    radial-gradient(760px 560px at 90% -8%, rgba(125,201,160,0.07), transparent 70%),
    radial-gradient(680px 520px at 2% 108%, rgba(140,115,85,0.09), transparent 70%);
}
.wordmark { position:absolute; top:56px; left:72px; font-family:'Cormorant Garamond',serif; font-weight:500; font-size:34px; letter-spacing:.01em; z-index:2; }
.wordmark::after { content:''; display:inline-block; width:10px; height:10px; border-radius:50%; background:#7dc9a0; margin-left:9px; margin-bottom:2px; }
.pageno { position:absolute; top:66px; right:72px; font-family:'DM Mono',monospace; font-size:20px; color:#8a8078; letter-spacing:.12em; z-index:2; }
.url { position:absolute; bottom:48px; right:72px; font-size:19px; color:#8a8078; letter-spacing:.08em; z-index:2; }
em { font-style:italic; color:#7dc9a0; font-weight:400; }

/* leak slides */
.bignum {
  position:absolute; top:96px; right:34px; z-index:1;
  font-family:'Cormorant Garamond',serif; font-weight:300; font-size:400px; line-height:1;
  color:transparent; -webkit-text-stroke:1.5px rgba(247,244,239,0.14);
}
.label { position:absolute; top:236px; left:72px; font-family:'DM Mono',monospace; font-size:23px; letter-spacing:.26em; text-transform:uppercase; color:#7dc9a0; z-index:2; }
.claim { position:absolute; top:320px; left:72px; right:72px; font-family:'Cormorant Garamond',serif; font-weight:300; font-size:67px; line-height:1.14; letter-spacing:-0.01em; z-index:2; }
.card {
  position:absolute; left:72px; right:72px; bottom:270px; z-index:2;
  background:#221d18; border:1px solid rgba(247,244,239,0.09); border-radius:20px;
  box-shadow:0 30px 70px rgba(0,0,0,0.35); overflow:hidden;
}
.card-head { padding:20px 30px; border-bottom:1px solid rgba(247,244,239,0.07); font-family:'DM Mono',monospace; font-size:20px; color:#8a8078; display:flex; }
.card-head .fix-chip { margin-left:auto; color:#7dc9a0; }
.diff { font-family:'DM Mono',monospace; font-size:27px; line-height:2.1; padding:18px 0; }
.dl { display:flex; white-space:pre; padding:0 30px; }
.dl.del { background:rgba(224,120,86,0.10); color:#e09a80; }
.dl.add { background:rgba(125,201,160,0.10); color:#9fd8ba; }
.dl .sign { width:44px; flex:none; }
.fixline { position:absolute; left:72px; right:72px; bottom:150px; font-size:31px; font-weight:300; color:#cfc8c0; z-index:2; }
.fixline b { color:#7dc9a0; font-weight:500; font-family:'DM Mono',monospace; font-size:26px; letter-spacing:.12em; text-transform:uppercase; margin-right:14px; }
.swipe { position:absolute; bottom:48px; left:72px; font-family:'DM Mono',monospace; font-size:20px; color:#8a8078; letter-spacing:.12em; z-index:2; }
"""

def page(title, extra_css, body):
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{html.escape(title)}</title>
<style>{BASE_CSS}{extra_css}</style></head>
<body>
{body}
</body></html>"""

def chrome_header(n):
    return f'<div class="wordmark">Velyr</div><div class="pageno">{n:02d} / 07</div>'

def leak_slide(n, name, claim, del_line, add_line, fixline):
    body = f"""{chrome_header(n)}
<div class="bignum">{n-1:02d}</div>
<div class="label">Leak {n-1:02d} — {name}</div>
<div class="claim">{claim}</div>
<div class="card">
  <div class="card-head">the one-line fix<span class="fix-chip">+1 −1</span></div>
  <div class="diff">
    <div class="dl del"><span class="sign">−</span>{html.escape(del_line)}</div>
    <div class="dl add"><span class="sign">+</span>{html.escape(add_line)}</div>
  </div>
</div>
<div class="fixline"><b>Fix</b>{fixline}</div>
<div class="swipe">swipe →</div>
<div class="url">velyr.io</div>"""
    return page(f"Slide {n}", "", body)

slides = {}

# ---- Slide 1: hook ----
hook_css = """
.hook-wrap { position:absolute; top:0; left:0; right:0; bottom:0; display:flex; flex-direction:column; justify-content:center; padding:0 84px; z-index:2; }
.hook-kicker { font-family:'DM Mono',monospace; font-size:23px; letter-spacing:.26em; text-transform:uppercase; color:#7dc9a0; margin-bottom:44px; }
.hook-title { font-family:'Cormorant Garamond',serif; font-weight:300; font-size:126px; line-height:1.04; letter-spacing:-0.015em; }
.hook-sub { margin-top:52px; font-size:34px; color:#b5aca3; line-height:1.5; max-width:820px; }
.hook-cue { position:absolute; bottom:52px; left:84px; font-family:'DM Mono',monospace; font-size:22px; color:#7dc9a0; letter-spacing:.14em; }
"""
slides[1] = page("Slide 1", hook_css, f"""{chrome_header(1)}
<div class="hook-wrap">
  <div class="hook-kicker">A field guide</div>
  <div class="hook-title">Your homepage is <em>leaking</em> signups.</div>
  <div class="hook-sub">The 5 leaks we keep finding on founder sites — and the one-line fix for each.</div>
</div>
<div class="hook-cue">swipe → → →</div>
<div class="url">velyr.io</div>""")

# ---- Slides 2-6: leaks ----
slides[2] = leak_slide(2, "The buried CTA",
    'Your first real CTA shows up <em>1,300px down</em> the page. Most mobile visitors never scroll that far.',
    '<a href="#features">Learn more</a>',
    '<a href="/signup">Start free →</a>',
    'One primary action, inside the first screen.')

slides[3] = leak_slide(3, "The clever headline",
    'If a stranger can’t say what you sell after <em>5 seconds</em>, your headline is decoration.',
    'Reimagine the way you work',
    'Invoices your clients pay in 1 click',
    'Say the thing. Save the poetry for the blog.')

slides[4] = leak_slide(4, "Too many doors",
    '6 nav links, 3 CTAs, a chat bubble, a popup. Every extra choice <em>taxes the one that pays you</em>.',
    'Features Pricing Blog Docs About Careers',
    'Pricing Login',
    'Cut until it hurts. Then cut one more.')

slides[5] = leak_slide(5, "Proof nobody can check",
    '“Loved by thousands” reads as filler. A number someone <em>could verify</em> reads as proof.',
    'Trusted by industry leaders',
    '1,204 invoices sent last week',
    'Specific beats superlative — if it’s true.')

slides[6] = leak_slide(6, "The button that isn’t",
    'Rage-clicks don’t lie: visitors keep tapping things that <em>look clickable</em> and aren’t.',
    '<div class="pricing-card">',
    '<button onClick={choosePlan}>',
    'If it looks tappable, make it tappable.')

# ---- Slide 7: closer ----
closer_css = """
.close-wrap { position:absolute; top:0; left:0; right:0; bottom:0; display:flex; flex-direction:column; justify-content:center; padding:0 84px; z-index:2; }
.close-title { font-family:'Cormorant Garamond',serif; font-weight:300; font-size:96px; line-height:1.08; letter-spacing:-0.01em; }
.close-body { margin-top:56px; font-size:35px; color:#cfc8c0; line-height:1.58; max-width:880px; }
.close-body b { color:#f7f4ef; font-weight:400; }
.close-cta { margin-top:64px; display:flex; align-items:center; gap:22px; }
.close-pill { background:#7dc9a0; color:#191512; font-weight:500; font-size:29px; padding:20px 44px; border-radius:99px; letter-spacing:.02em; }
.close-note { font-family:'DM Mono',monospace; font-size:21px; color:#8a8078; letter-spacing:.06em; }
"""
slides[7] = page("Slide 7", closer_css, f"""{chrome_header(7)}
<div class="close-wrap">
  <div class="close-title">Found one of these on your site? <em>There are more.</em></div>
  <div class="close-body">Velyr is an agent that hunts <b>one conversion leak per week</b> on your site — and ships the fix as a real <b>pull request</b>. You approve it with one tap on Telegram.</div>
  <div class="close-cta">
    <div class="close-pill">velyr.io</div>
    <div class="close-note">autonomous growth agent</div>
  </div>
</div>
<div class="url">velyr.io</div>""")

for n, doc in slides.items():
    p = os.path.join(OUT, f"slide-{n}.html")
    with open(p, "w", encoding="utf-8") as f:
        f.write(doc)
    print("wrote", p)
