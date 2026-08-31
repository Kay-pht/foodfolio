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

extract_metadata() {
  local url="$1"
  local metadata="$2"
  local log="$3"
  local mode="$4"

  if [[ "$mode" == "chrome" ]]; then
    if "$YT_DLP" \
      "${COMMON_ARGS[@]}" \
      --impersonate chrome \
      --skip-download \
      --dump-single-json \
      --verbose \
      "$url" > "$metadata" 2> "$log"; then
      print_metadata_summary "$metadata"
      return $?
    fi
  else
    if "$YT_DLP" \
      "${COMMON_ARGS[@]}" \
      --skip-download \
      --dump-single-json \
      --verbose \
      "$url" > "$metadata" 2> "$log"; then
      print_metadata_summary "$metadata"
      return $?
    fi
  fi

  return 1
}

SUCCESS_URLS=()
SUCCESS_MODES=()
FAILURE_COUNT=0

echo
echo "== 1. Metadata / available media formats =="
for index in "${!URLS[@]}"; do
  url="${URLS[$index]}"
  metadata="$WORK_DIR/metadata-$index.json"
  log="$WORK_DIR/metadata-$index.log"

  echo
  echo "URL: $url"
  echo "Attempt 1: yt-dlp default TikTok extraction"

  if extract_metadata "$url" "$metadata" "$log" "default"; then
    SUCCESS_URLS+=("$url")
    SUCCESS_MODES+=("default")
    echo "Metadata SUCCESS (default)"
    continue
  fi

  echo "Default extraction failed. Last diagnostic lines:"
  tail -n 12 "$log" || true
  echo
  echo "Attempt 2: explicit Chrome request impersonation"

  if extract_metadata "$url" "$metadata" "$log" "chrome"; then
    SUCCESS_URLS+=("$url")
    SUCCESS_MODES+=("chrome")
    echo "Metadata SUCCESS (Chrome impersonation)"
    continue
  fi

  FAILURE_COUNT=$((FAILURE_COUNT + 1))
  echo "Chrome impersonation also failed. Last diagnostic lines:"
  tail -n 20 "$log" || true
  echo "Metadata FAILED for this URL; continuing with the remaining URLs."
done

echo
echo "Metadata result: ${#SUCCESS_URLS[@]} succeeded / ${#URLS[@]} tested"

if [[ ${#SUCCESS_URLS[@]} -eq 0 ]]; then
  echo >&2
  echo "PoC FAILED before video download: none of the tested TikTok URLs exposed usable metadata." >&2
  if [[ -z "${TIKTOK_POC_COOKIES_FROM_BROWSER:-}" ]]; then
    echo >&2
    echo "Next diagnostic: retry with your own logged-in TikTok browser session." >&2
    echo "Chrome:" >&2
    echo "  TIKTOK_POC_COOKIES_FROM_BROWSER=chrome npm run poc:tiktok-video" >&2
    echo "Safari:" >&2
    echo "  TIKTOK_POC_COOKIES_FROM_BROWSER=safari npm run poc:tiktok-video" >&2
  else
    echo "Browser cookies were already supplied, so this is not merely the anonymous-web path failing." >&2
  fi
  echo "Set KEEP_TIKTOK_POC_VIDEO=1 to retain verbose metadata logs in the displayed temp directory." >&2
  exit 1
fi

DOWNLOAD_URL="${TIKTOK_POC_DOWNLOAD_URL:-${SUCCESS_URLS[0]}}"
DOWNLOAD_MODE="${SUCCESS_MODES[0]}"
OUTPUT_TEMPLATE="$WORK_DIR/tiktok-poc.%(ext)s"

echo
echo "== 2. Download one TikTok video as MP4 =="
echo "URL: $DOWNLOAD_URL"
echo "Extraction mode: $DOWNLOAD_MODE"

if [[ "$DOWNLOAD_MODE" == "chrome" ]]; then
  "$YT_DLP" \
    "${COMMON_ARGS[@]}" \
    --impersonate chrome \
    --max-filesize 100M \
    -f 'b[ext=mp4]' \
    -o "$OUTPUT_TEMPLATE" \
    "$DOWNLOAD_URL"
else
  "$YT_DLP" \
    "${COMMON_ARGS[@]}" \
    --max-filesize 100M \
    -f 'b[ext=mp4]' \
    -o "$OUTPUT_TEMPLATE" \
    "$DOWNLOAD_URL"
fi

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
echo "PoC SUCCESS: at least one TikTok URL exposed metadata and an MP4 file was downloaded."
if [[ "$FAILURE_COUNT" -gt 0 ]]; then
  echo "Note: $FAILURE_COUNT URL(s) failed metadata extraction; see the diagnostic output above."
fi
if [[ "$KEEP_OUTPUT" != "1" ]]; then
  echo "The downloaded video and diagnostic files will be deleted when this script exits."
fi
