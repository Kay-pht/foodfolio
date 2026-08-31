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

if [[ $# -eq 1 ]]; then
  URLS=("$1")
else
  URLS=("${DEFAULT_URLS[@]}")
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/foodfolio-tiktok-poc.XXXXXX")"
KEEP_OUTPUT="${KEEP_TIKTOK_POC_VIDEO:-0}"

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

echo
echo "== 1. Metadata / available media formats =="
for index in "${!URLS[@]}"; do
  url="${URLS[$index]}"
  metadata="$WORK_DIR/metadata-$index.json"

  echo
echo "URL: $url"
  "$YT_DLP" \
    "${COMMON_ARGS[@]}" \
    --skip-download \
    --dump-single-json \
    "$url" > "$metadata"

  node - "$metadata" <<'NODE'
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
done

DOWNLOAD_URL="${TIKTOK_POC_DOWNLOAD_URL:-${URLS[0]}}"
OUTPUT_TEMPLATE="$WORK_DIR/tiktok-poc.%(ext)s"

echo
echo "== 2. Download one TikTok video as MP4 =="
echo "URL: $DOWNLOAD_URL"
"$YT_DLP" \
  "${COMMON_ARGS[@]}" \
  --max-filesize 100M \
  -f 'b[ext=mp4]' \
  -o "$OUTPUT_TEMPLATE" \
  "$DOWNLOAD_URL"

DOWNLOADED_FILE="$(find "$WORK_DIR" -maxdepth 1 -type f -name 'tiktok-poc.*' | head -n 1)"
if [[ -z "$DOWNLOADED_FILE" ]]; then
  echo "Download command completed but no output file was found." >&2
  exit 1
fi

if stat -f '%z' "$DOWNLOADED_FILE" >/dev/null 2>&1; then
  FILE_SIZE="$(stat -f '%z' "$DOWNLOADED_FILE")"
else
  FILE_SIZE="$(stat -c '%s' "$DOWNLOADED_FILE")"
fi

if [[ "$FILE_SIZE" -le 0 ]]; then
  echo "Downloaded file is empty: $DOWNLOADED_FILE" >&2
  exit 1
fi

echo "Downloaded: $DOWNLOADED_FILE"
echo "Size: $FILE_SIZE bytes"
file "$DOWNLOADED_FILE" || true

if command -v ffprobe >/dev/null 2>&1; then
  echo
echo "== 3. ffprobe media inspection =="
  ffprobe \
    -v error \
    -show_entries format=format_name,duration,size:stream=index,codec_type,codec_name,width,height \
    -of json \
    "$DOWNLOADED_FILE"
else
  echo
echo "ffprobe was not found; stream-level inspection was skipped."
  echo "On macOS, install it with: brew install ffmpeg"
fi

echo
echo "PoC SUCCESS: TikTok metadata was extracted and an MP4 file was downloaded."
if [[ "$KEEP_OUTPUT" != "1" ]]; then
  echo "The downloaded video will be deleted when this script exits."
fi
