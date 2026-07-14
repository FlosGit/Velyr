#!/usr/bin/env bash
# Publishes the 7-slide carousel to Instagram.
# Run from this folder AFTER fixing the Instagram token in ../../.env.local:
#   bash publish-instagram.sh
# Re-stages the JPEGs on litterbox itself (links expire after 1h), so it works standalone.
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE="../../.env.local"
TOKEN=$(grep '^INSTAGRAM_ACCESS_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
API="https://graph.instagram.com/v23.0"

echo "== sanity check token =="
ME=$(curl -s "$API/me?fields=id,username&access_token=$TOKEN")
echo "$ME" | grep -q '"id"' || { echo "Token still broken: $ME"; exit 1; }
echo "$ME"

echo "== staging images on litterbox (1h) =="
CHILDREN=()
for i in 1 2 3 4 5 6 7; do
  URL=$(curl -s -F reqtype=fileupload -F time=1h -F fileToUpload=@jpg/slide-$i.jpg https://litterbox.catbox.moe/resources/internals/api.php)
  echo "slide-$i -> $URL"
  RES=$(curl -s -X POST "$API/me/media" -d "image_url=$URL" -d "is_carousel_item=true" -d "access_token=$TOKEN")
  ID=$(echo "$RES" | python -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
  [ -n "$ID" ] || { echo "container failed: $RES"; exit 1; }
  CHILDREN+=("$ID")
done

echo "== creating carousel container =="
KIDS=$(IFS=,; echo "${CHILDREN[*]}")
CAR=$(curl -s -X POST "$API/me/media" \
  -d "media_type=CAROUSEL" \
  -d "children=$KIDS" \
  --data-urlencode "caption@caption.txt" \
  -d "access_token=$TOKEN")
CAR_ID=$(echo "$CAR" | python -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
[ -n "$CAR_ID" ] || { echo "carousel container failed: $CAR"; exit 1; }
echo "container: $CAR_ID"

echo "== waiting for container to finish processing =="
for n in $(seq 1 20); do
  ST=$(curl -s "$API/$CAR_ID?fields=status_code&access_token=$TOKEN" | python -c "import sys,json;print(json.load(sys.stdin).get('status_code',''))")
  echo "status: $ST"
  [ "$ST" = "FINISHED" ] && break
  [ "$ST" = "ERROR" ] && { echo "container processing failed"; exit 1; }
  sleep 3
done

echo "== publishing =="
PUB=$(curl -s -X POST "$API/me/media_publish" -d "creation_id=$CAR_ID" -d "access_token=$TOKEN")
echo "$PUB"
MEDIA_ID=$(echo "$PUB" | python -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
[ -n "$MEDIA_ID" ] && curl -s "$API/$MEDIA_ID?fields=permalink&access_token=$TOKEN"
echo
echo "done."
