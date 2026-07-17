#!/usr/bin/env bash
# Encodes the frame-by-frame PNGs (png/f-*.png @30fps) into velyr-agent-loop.mp4 (1080x1920, ~10.2s).
# No zoompan, no xfade: the motion is already IN the frames (render.cjs drives scene.html's __seek).
# Music bed = the licensed Pixabay track already used in product-hunt/video/velyr-launch.mp4
# (verified music-only: silence gaps exist only at its 0-4.95s intro and 70.8s outro).
set -euo pipefail
cd "$(dirname "$0")"

FPS=30
OUT="velyr-agent-loop.mp4"
MUSIC="../../product-hunt/video/velyr-launch.mp4"
DUR=$(python -c "import os,glob;print(len(glob.glob('png/f-*.png'))/$FPS)")
echo "== frames: $(ls png/f-*.png | wc -l)  duration: ${DUR}s =="

echo "== video track =="
ffmpeg -y -framerate $FPS -i "png/f-%04d.png" \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart \
  -vf "scale=1080:1920,setsar=1" \
  video-only.mp4 >/dev/null 2>&1

echo "== music bed (slice from the continuous middle of the track) =="
ffmpeg -y -ss 20 -t "$DUR" -i "$MUSIC" -vn \
  -af "afade=t=in:st=0:d=0.4,afade=t=out:st=$(python -c "print(round($DUR-0.6,2))"):d=0.6,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100" \
  -c:a aac -b:a 128k -ar 44100 -ac 2 \
  audio-only.m4a >/dev/null 2>&1

echo "== mux =="
ffmpeg -y -i video-only.mp4 -i audio-only.m4a \
  -c:v copy -c:a aac -b:a 128k -movflags +faststart -shortest \
  "$OUT" >/dev/null 2>&1
rm -f video-only.mp4 audio-only.m4a

echo "== done =="
ffprobe -v error -show_entries format=duration,size:stream=codec_type,codec_name,width,height -of default=noprint_wrappers=1 "$OUT"
