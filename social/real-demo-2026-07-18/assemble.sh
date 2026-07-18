#!/usr/bin/env bash
# Assembles velyr-real-demo.mp4 (1080x1920, 30fps, ~13.6s):
#   seq/s-%04d.png  ->  H.264 + burned-in karaoke captions (captions.ass)
#   audio = edge-tts VO (primary, +150ms) + low Pixabay music bed
#   (bed sliced from product-hunt/video/velyr-launch.mp4, verified music-only)
set -euo pipefail
cd "$(dirname "$0")"

FPS=30
OUT="velyr-real-demo.mp4"
MUSIC="../../product-hunt/video/velyr-launch.mp4"
DUR=$(python -c "import glob;print(len(glob.glob('seq/s-*.png'))/$FPS)")
echo "== frames: $(ls seq/s-*.png | wc -l)  duration: ${DUR}s =="

echo "== video track (with captions) =="
ffmpeg -y -framerate $FPS -i "seq/s-%04d.png" \
  -vf "scale=1080:1920:flags=lanczos,setsar=1,subtitles=captions.ass" \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart \
  video-only.mp4 >/dev/null 2>&1

echo "== audio (VO primary + music bed) =="
ffmpeg -y -i vo/vo.mp3 -ss 24 -t "$DUR" -i "$MUSIC" -filter_complex "
  [0:a]adelay=150|150,apad,atrim=0:${DUR},loudnorm=I=-15:TP=-2:LRA=11,aresample=44100[vo];
  [1:a]afade=t=in:st=0:d=0.5,afade=t=out:st=$(python -c "print(round($DUR-0.8,2))"):d=0.8,loudnorm=I=-28:TP=-6:LRA=11,aresample=44100[m];
  [vo][m]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.85[mix]
" -map "[mix]" -c:a aac -b:a 128k -ar 44100 -ac 2 audio-only.m4a >/dev/null 2>&1

echo "== mux =="
ffmpeg -y -i video-only.mp4 -i audio-only.m4a \
  -c:v copy -c:a copy -movflags +faststart -shortest \
  "$OUT" >/dev/null 2>&1
rm -f video-only.mp4 audio-only.m4a

echo "== done =="
ffprobe -v error -show_entries format=duration,size:stream=codec_type,codec_name,width,height -of default=noprint_wrappers=1 "$OUT"
