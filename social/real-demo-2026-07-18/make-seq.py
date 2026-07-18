# Builds the final frame sequence seq/s-%04d.png from the per-scene captures,
# using exactly the segment lengths of the cut plan (30fps, 408 frames = 13.6s).
import os, shutil, glob

PLAN = [  # (scene, frames)
    ("hero", 90),      # 0.00-3.00  "My website was leaking sales..."
    ("code", 47),      # 3.00-4.57  "So I gave an AI my code."
    ("leak", 96),      # 4.57-7.77  "Every Monday it finds... sends me the fix."
    ("approve", 55),   # 7.77-9.60  "I reply YES - it ships."  (real Deployed card)
    ("rollback", 64),  # 9.60-11.73 "Numbers drop? One YES rolls it back."
    ("cta", 56),       # 11.73-13.60 end card (real CTA card) + velyr.io tag
]

os.makedirs("seq", exist_ok=True)
for f in glob.glob("seq/s-*.png"):
    os.remove(f)

i = 0
for scene, n in PLAN:
    avail = sorted(glob.glob(f"png/{scene}/f-*.png"))
    assert len(avail) >= n, f"{scene}: need {n}, have {len(avail)}"
    for k in range(n):
        shutil.copyfile(avail[k], f"seq/s-{i:04d}.png")
        i += 1
print(f"seq built: {i} frames = {i/30:.2f}s")
