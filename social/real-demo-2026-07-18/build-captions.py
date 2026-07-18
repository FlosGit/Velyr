# Builds captions.ass (karaoke word-highlight) from vo/words.json.
# Groups of 2-3 words, white -> brand-green highlight as spoken, +LEAD shift.
#   python build-captions.py
import json

LEAD = 0.15          # VO delay vs video start (s)
TOTAL = 13.60        # video length (s)
words = json.load(open("vo/words.json"))

# group boundaries by word index (see words.json order)
GROUPS = [
    [0, 1],          # MY WEBSITE
    [2, 3, 4],       # WAS LEAKING SALES
    [5, 6, 7],       # AND I COULDN'T
    [8, 9],          # SEE WHERE
    [10, 11, 12],    # SO I GAVE
    [13, 14],        # AN AI
    [15, 16],        # MY CODE
    [17, 18],        # EVERY MONDAY
    [19, 20],        # IT FINDS
    [21, 22, 23],    # THE BIGGEST LEAK
    [24, 25, 26],    # AND SENDS ME
    [27, 28],        # THE FIX
    [29, 30, 31],    # I REPLY YES
    [32, 33],        # IT SHIPS
    [34, 35],        # NUMBERS DROP?
    [36, 37],        # ONE YES
    [38, 39, 40],    # ROLLS IT BACK
]
SUFFIX = {35: "?", 4: ","}   # cosmetic punctuation on last word of a phrase

def ts(t):
    t = max(0.0, t)
    h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"

HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Arial Black,84,&H00415B1F,&H00FFFFFF,&H00141414,&H96000000,-1,0,0,0,100,100,1,0,1,7,3,2,40,40,560,1
Style: Tag,Arial Black,66,&H00FFFFFF,&H00FFFFFF,&H00302B14,&H96000000,-1,0,0,0,100,100,2,0,1,6,2,2,40,40,500,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

lines = [HEADER]
for gi, g in enumerate(GROUPS):
    start = words[g[0]]["start"] + LEAD
    if gi + 1 < len(GROUPS):
        end = words[GROUPS[gi + 1][0]]["start"] + LEAD
    else:
        end = words[g[-1]]["end"] + LEAD + 0.45
    parts = []
    for wi in g:
        w = words[wi]
        dur_end = words[wi + 1]["start"] if wi + 1 < len(words) and wi != g[-1] else w["end"]
        k = max(1, round((dur_end - w["start"]) * 100))
        txt = w["word"].upper() + SUFFIX.get(wi, "")
        parts.append(f"{{\\k{k}}}{txt}")
    text = " ".join(parts)
    lines.append(f"Dialogue: 0,{ts(start)},{ts(end)},Cap,,0,0,0,,{text}")

# end tag over the CTA scene
lines.append(f"Dialogue: 0,{ts(11.95)},{ts(TOTAL)},Tag,,0,0,0,,velyr.io")

open("captions.ass", "w", encoding="utf-8").write("\n".join(lines) + "\n")
print(f"captions.ass written: {len(GROUPS)} caption groups + end tag")
