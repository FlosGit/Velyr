#!/usr/bin/env bash
# Stitches the 6 rendered scene PNGs into velyr-demo-short.mp4 (1080x1920, ~18.7s).
# Each scene = subtle slow zoom; xfade transitions between them (motion follows the story:
# slideup when the Telegram fix arrives, fade when YES appears in-place, slideleft to GitHub/graph).
# Adds a silent AAC track (IG reels expect an audio stream; matches the prior short's structure).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p clips

FPS=30
# scene | duration(s) | zoom-target
SCENES=( "1-hook:3.0" "2-telegram:4.0" "3-yes:3.6" "4-pr:3.4" "5-graph:3.8" "6-close:3.4" )
T=0.5   # xfade duration

echo "== per-scene zoom clips =="
for s in "${SCENES[@]}"; do
  name="${s%%:*}"; dur="${s##*:}"
  frames=$(python -c "print(int($dur*$FPS))")
  # upscale 2x -> zoompan -> downscale keeps text crisp and the drift smooth
  ffmpeg -y -loop 1 -i "png/scene-$name.png" -t "$dur" -r $FPS \
    -vf "scale=2160:3840,zoompan=z='min(zoom+0.00035,1.05)':d=$frames:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=2160x3840:fps=$FPS,scale=1080:1920,setsar=1,format=yuv420p" \
    -c:v libx264 -preset medium -crf 18 "clips/$name.mp4" >/dev/null 2>&1
  echo "  clip $name ($dur s, $frames f)"
done

echo "== xfade chain =="
TR=( slideup fade slideleft slideleft fade )   # 5 transitions between 6 scenes
DUR=( 3.0 4.0 3.6 3.4 3.8 3.4 )

# build filter_complex offsets
inputs=""
for s in "${SCENES[@]}"; do name="${s%%:*}"; inputs="$inputs -i clips/$name.mp4"; done

# cumulative xfade
fc=""
prev="[0:v]"
acc=0
for i in 0 1 2 3 4; do
  d=${DUR[$i]}
  acc=$(python -c "print(round($acc + $d - $T, 3))")
  # offset for this xfade = (length so far) ; length so far after i-th add handled by acc
  off=$(python -c "print(round($acc, 3))")
  nxt=$(( i + 1 ))
  lbl="[v$nxt]"
  [ $i -eq 4 ] && lbl="[vout]"
  fc="$fc$prev[$nxt:v]xfade=transition=${TR[$i]}:duration=$T:offset=$off$lbl; "
  prev="$lbl"
done

TOTAL=$(python -c "print(round(sum([3.0,4.0,3.6,3.4,3.8,3.4]) - 5*$T, 3))")
echo "  total ${TOTAL}s"

ffmpeg -y $inputs \
  -f lavfi -t "$TOTAL" -i anullsrc=channel_layout=stereo:sample_rate=44100 \
  -filter_complex "${fc%; }" \
  -map "[vout]" -map "6:a" \
  -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p -movflags +faststart \
  -c:a aac -b:a 96k -shortest \
  velyr-demo-short.mp4 >/dev/null 2>&1

echo "== done =="
ffprobe -v error -show_entries format=duration:stream=codec_type,codec_name,width,height -of default=noprint_wrappers=1 velyr-demo-short.mp4
ls -la velyr-demo-short.mp4
