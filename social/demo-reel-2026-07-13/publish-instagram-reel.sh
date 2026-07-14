#!/usr/bin/env bash
# Publishes velyr-demo-short.mp4 as an Instagram Reel (@velyr.io).
# OPERATOR step — run only after Florian's go:  bash publish-instagram-reel.sh
# Re-stages the mp4 on litterbox (links expire after 1h), so it's standalone.
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE="../../.env.local"
TOKEN=$(grep '^INSTAGRAM_ACCESS_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
API="https://graph.instagram.com/v23.0"
VIDEO="velyr-demo-short.mp4"

echo "== sanity check token =="
ME=$(curl -s "$API/me?fields=id,username&access_token=$TOKEN")
echo "$ME" | grep -q '"id"' || { echo "Token broken: $ME"; exit 1; }
echo "$ME"

echo "== staging video on litterbox (1h) =="
VURL=$(curl -s -F reqtype=fileupload -F time=1h -F fileToUpload=@"$VIDEO" https://litterbox.catbox.moe/resources/internals/api.php)
echo "video -> $VURL"
echo "$VURL" | grep -q '^https' || { echo "litterbox upload failed: $VURL"; exit 1; }

echo "== creating REELS container =="
CReel=$(curl -s -X POST "$API/me/media" \
  -d "media_type=REELS" \
  -d "video_url=$VURL" \
  -d "share_to_feed=true" \
  --data-urlencode "caption@caption.txt" \
  -d "access_token=$TOKEN")
CID=$(echo "$CReel" | python -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
[ -n "$CID" ] || { echo "container failed: $CReel"; exit 1; }
echo "container: $CID"

echo "== waiting for video processing (reels take a bit) =="
for n in $(seq 1 40); do
  ST=$(curl -s "$API/$CID?fields=status_code&access_token=$TOKEN" | python -c "import sys,json;print(json.load(sys.stdin).get('status_code',''))")
  echo "status: $ST"
  [ "$ST" = "FINISHED" ] && break
  [ "$ST" = "ERROR" ] && { echo "processing failed"; exit 1; }
  sleep 5
done

echo "== publishing =="
PUB=$(curl -s -X POST "$API/me/media_publish" -d "creation_id=$CID" -d "access_token=$TOKEN")
echo "$PUB"
MID=$(echo "$PUB" | python -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
[ -n "$MID" ] && curl -s "$API/$MID?fields=permalink&access_token=$TOKEN"
echo
echo "done."
