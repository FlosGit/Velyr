#!/usr/bin/env bash
# Uploads velyr-agent-loop.mp4 as a YouTube Short (metadata in yt-meta.json).
# OPERATOR step — run only after Florian's go:  bash publish-youtube-short.sh
# Uses the youtube.upload refresh token in ../../.env.local (resumable upload via curl).
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE="../../.env.local"
CID=$(grep '^YOUTUBE_CLIENT_ID='     "$ENV_FILE" | cut -d= -f2-)
CSECRET=$(grep '^YOUTUBE_CLIENT_SECRET=' "$ENV_FILE" | cut -d= -f2-)
RTOKEN=$(grep '^YOUTUBE_REFRESH_TOKEN='  "$ENV_FILE" | cut -d= -f2-)
VIDEO="velyr-agent-loop.mp4"

echo "== exchanging refresh token for access token =="
AT=$(curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=$CID" -d "client_secret=$CSECRET" \
  -d "refresh_token=$RTOKEN" -d "grant_type=refresh_token" \
  | python -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))")
[ -n "$AT" ] || { echo "token exchange failed"; exit 1; }
echo "access token ok"

echo "== initiating resumable upload =="
HDRS=$(mktemp)
curl -s -D "$HDRS" -o /dev/null -X POST \
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status" \
  -H "Authorization: Bearer $AT" \
  -H "Content-Type: application/json; charset=UTF-8" \
  -H "X-Upload-Content-Type: video/*" \
  --data @yt-meta.json
UPURL=$(grep -i '^location:' "$HDRS" | tr -d '\r' | awk '{print $2}')
rm -f "$HDRS"
[ -n "$UPURL" ] || { echo "no resumable URL returned"; exit 1; }
echo "upload session ok"

echo "== uploading video bytes =="
RES=$(curl -s -X PUT "$UPURL" -H "Content-Type: video/*" --data-binary @"$VIDEO")
VID=$(echo "$RES" | python -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
[ -n "$VID" ] || { echo "upload failed: $RES"; exit 1; }
echo "done -> https://youtube.com/shorts/$VID"
