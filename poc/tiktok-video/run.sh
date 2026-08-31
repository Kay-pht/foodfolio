#!/usr/bin/env bash
set -euo pipefail

YT_DLP_VERSION="2026.08.19"
DEFAULT_URLS=(
  "https://www.tiktok.com/@shimatassin/video/7503733456203992328"
  "https://www.tiktok.com/@nasutonaru/video/6919749564979383554"
  "https://www.tiktok.com/@bayashi.tiktok/video/6920502857028455681"
)

if (( $# > 1 )); then
  echo "Usage: bash poc/tiktok-video/run.sh [TikTok URL]" >&2
  exit 2
fi

normalize_url() {
  local input="$1"
  local markdown_regex='^\[[^]]*\]\((https?://[^)]*)\)$'

  if [[ "$input" =~ $markdown_regex ]]; then
    input="${BASH_REMATCH[1]}"
  fi

  input="${input//\\_/_}"
  printf '%s\n' "$input"
}

if [[ $# -eq 1 ]]; then
  URLS=("$(normalize_url "$1")")
else
  URLS=("${DEFAULT_URLS[@]}")
fi

KEEP_OUTPUT="${KEEP_TIKTOK_POC_VIDEO:-0}"
MAX_ATTEMPTS="${TIKTOK_POC_MAX_ATTEMPTS:-5}"
RETRY_BASE_SECONDS="${TIKTOK_POC_RETRY_BASE_SECONDS:-2}"
MAX_RETRY_SECONDS="${TIKTOK_POC_MAX_RETRY_SECONDS:-10}"

if ! [[ "$MAX_ATTEMPTS" =~ ^[1-9][0-9]*$ ]]; then
  echo "TIKTOK_POC_MAX_ATTEMPTS must be a positive integer: $MAX_ATTEMPTS" >&2
  exit 2
fi

if ! [[ "$RETRY_BASE_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "TIKTOK_POC_RETRY_BASE_SECONDS must be a non-negative integer: $RETRY_BASE_SECONDS" >&2
  exit 2
fi

if ! [[ "$MAX_RETRY_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "TIKTOK_POC_MAX_RETRY_SECONDS must be a non-negative integer: $MAX_RETRY_SECONDS" >&2
  exit 2
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/foodfolio-tiktok-poc.XXXXXX")"

cleanup() {
  if [[ "$KEEP_OUTPUT" == "1" ]]; then
    echo
    echo "PoC files retained at: $WORK_DIR"
  else
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

require_command curl
require_command node

resolve_yt_dlp() {
  if [[ -n "${YT_DLP_BIN:-}" ]]; then
    if [[ ! -x "$YT_DLP_BIN" ]]; then
      echo "YT_DLP_BIN is not executable: $YT_DLP_BIN" >&2
      exit 1
    fi
    printf '%s\n' "$YT_DLP_BIN"
    return
  fi

  local os asset target
  os="$(uname -s)"
  case "$os" in
    Darwin)
      asset="yt-dlp_macos"
      ;;
    Linux)
      asset="yt-dlp_linux"
      ;;
    *)
      echo "Unsupported OS for automatic yt-dlp download: $os" >&2
      echo "Set YT_DLP_BIN to an existing yt-dlp executable." >&2
      exit 1
      ;;
  esac

  target="$WORK_DIR/yt-dlp"
  echo "Downloading yt-dlp $YT_DLP_VERSION ($asset)..." >&2
  curl -fL --retry 3 \
    -o "$target" \
    "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/${asset}"
  chmod +x "$target"
  printf '%s\n' "$target"
}

YT_DLP="$(resolve_yt_dlp)"
YT_DLP_ACTUAL_VERSION="$($YT_DLP --version)"
echo "yt-dlp: $YT_DLP_ACTUAL_VERSION"

COMMON_ARGS=(--no-playlist)
if [[ -n "${TIKTOK_POC_COOKIES_FROM_BROWSER:-}" ]]; then
  COMMON_ARGS+=(--cookies-from-browser "$TIKTOK_POC_COOKIES_FROM_BROWSER")
  echo "Browser cookies: $TIKTOK_POC_COOKIES_FROM_BROWSER"
fi

COMMON_ARGS+=(
  --retries 3
  --fragment-retries 3
  --extractor-retries 3
  --sleep-requests 1
)

print_metadata_summary() {
  local metadata="$1"
  node --input-type=commonjs - "$metadata" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const formats = Array.isArray(data.formats) ? data.formats : [];
const mp4Formats = formats.filter((format) => format?.ext === 'mp4');
const subtitleLanguages = Object.keys(data.subtitles ?? {});
console.log(JSON.stringify({
  id: data.id ?? null,
  title: data.title ?? null,
  durationSeconds: data.duration ?? null,
  uploader: data.uploader ?? null,
  formatCount: formats.length,
  mp4FormatCount: mp4Formats.length,
  subtitleLanguages,
}, null, 2));
if (mp4Formats.length === 0) {
  console.error('No MP4 format was exposed for this URL.');
  process.exitCode = 1;
}
NODE
}

remove_attempt_artifacts() {
  local index="$1"
  find "$WORK_DIR" -maxdepth 1 -type f \
    \( -name "video-$index.*" -o -name "video-$index.part" \) \
    -delete
}

find_downloaded_file() {
  local index="$1"
  find "$WORK_DIR" -maxdepth 1 -type f -name "video-$index.mp4" -print -quit
}

file_size() {
  local path="$1"
  if stat -f '%z' "$path" >/dev/null 2>&1; then
    stat -f '%z' "$path"
  else
    stat -c '%s' "$path"
  fi
}

download_video_once() {
  local url="$1"
  local index="$2"
  local log="$3"

  "$YT_DLP" \
    "${COMMON_ARGS[@]}" \
    --max-filesize 100M \
    -f 'b[ext=mp4]' \
    --write-info-json \
    --verbose \
    -o "$WORK_DIR/video-$index.%(ext)s" \
    "$url" > "$log" 2>&1
}

SUCCESS_COUNT=0
FAILURE_COUNT=0
TOTAL_ATTEMPTS=0

echo
echo "== TikTok MP4 download with bounded whole-operation retries =="
echo "Maximum attempts per URL: $MAX_ATTEMPTS"
for index in "${!URLS[@]}"; do
  url="${URLS[$index]}"
  echo
  echo "URL: $url"
  url_succeeded=0
  attempt=1

  while [[ "$attempt" -le "$MAX_ATTEMPTS" ]]; do
    TOTAL_ATTEMPTS=$((TOTAL_ATTEMPTS + 1))
    log="$WORK_DIR/attempt-$index-$attempt.log"
    remove_attempt_artifacts "$index"
    echo "Attempt $attempt/$MAX_ATTEMPTS: one extraction through MP4 download"

    if download_video_once "$url" "$index" "$log"; then
      downloaded_file="$(find_downloaded_file "$index")"
      metadata="$WORK_DIR/video-$index.info.json"
      if [[ -n "$downloaded_file" && -s "$downloaded_file" && -s "$metadata" ]]; then
        FILE_SIZE="$(file_size "$downloaded_file")"
        print_metadata_summary "$metadata"
        echo "Downloaded: $downloaded_file"
        echo "Size: $FILE_SIZE bytes"
        file "$downloaded_file" || true

        if command -v ffprobe >/dev/null 2>&1; then
          ffprobe \
            -v error \
            -show_entries format=format_name,duration,size:stream=index,codec_type,codec_name,width,height \
            -of json \
            "$downloaded_file"
        fi

        echo "URL SUCCESS on attempt $attempt"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        url_succeeded=1
        break
      fi
      echo "yt-dlp exited successfully but did not leave a non-empty MP4 and info JSON." >&2
    fi

    echo "Attempt $attempt failed. Last diagnostic lines:"
    tail -n 16 "$log" || true
    if [[ "$attempt" -lt "$MAX_ATTEMPTS" ]]; then
      retry_delay=$((RETRY_BASE_SECONDS * attempt))
      if [[ "$retry_delay" -gt "$MAX_RETRY_SECONDS" ]]; then
        retry_delay="$MAX_RETRY_SECONDS"
      fi
      echo "Retrying in $retry_delay second(s) with a fresh yt-dlp process."
      sleep "$retry_delay"
    fi
    attempt=$((attempt + 1))
  done

  if [[ "$url_succeeded" -eq 0 ]]; then
    FAILURE_COUNT=$((FAILURE_COUNT + 1))
    echo "URL FAILED after $MAX_ATTEMPTS attempts." >&2
  fi
done

echo
echo "Result: $SUCCESS_COUNT succeeded / ${#URLS[@]} tested; $TOTAL_ATTEMPTS total attempt(s)"
if [[ "$FAILURE_COUNT" -gt 0 ]]; then
  echo "PoC FAILED: $FAILURE_COUNT URL(s) did not produce an MP4 within the retry limit." >&2
  if [[ -z "${TIKTOK_POC_COOKIES_FROM_BROWSER:-}" ]]; then
    echo "No browser cookies were used." >&2
  fi
  echo "Set KEEP_TIKTOK_POC_VIDEO=1 to retain verbose logs." >&2
  exit 1
fi

echo "PoC SUCCESS: every tested TikTok URL produced a non-empty MP4."
if ! command -v ffprobe >/dev/null 2>&1; then
  echo "ffprobe was not found; stream-level inspection was skipped."
fi
if [[ "$KEEP_OUTPUT" != "1" ]]; then
  echo "Downloaded videos, metadata, and diagnostic logs will be deleted on exit."
fi
