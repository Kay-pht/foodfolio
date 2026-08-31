#!/usr/bin/env bash
set -euo pipefail

BUNDLE_ID="${FOODFOLIO_BUNDLE_ID:-com.keyukt.foodfolio}"
RECIPE_ID="${1:-ui-recipe}"
RESULT="${2:-completed}"

if [[ ! "$RECIPE_ID" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "recipeId must contain only letters, numbers, hyphens, or underscores." >&2
  exit 2
fi

case "$RESULT" in
  completed)
    TITLE="レシピの解析が完了しました"
    BODY="Simulator通知テスト"
    ;;
  failed)
    TITLE="レシピの解析に失敗しました"
    BODY="Simulator通知テスト"
    ;;
  *)
    echo "Usage: npm run ios:push:simulator -- [recipeId] [completed|failed]" >&2
    exit 2
    ;;
esac

PAYLOAD="$(mktemp "${TMPDIR:-/tmp}/foodfolio-push.XXXXXX")"
trap 'rm -f "$PAYLOAD"' EXIT

cat >"$PAYLOAD" <<EOF
{
  "aps": {
    "alert": {
      "title": "$TITLE",
      "body": "$BODY"
    },
    "sound": "default"
  },
  "recipeId": "$RECIPE_ID",
  "analysisResult": "$RESULT"
}
EOF

xcrun simctl push booted "$BUNDLE_ID" "$PAYLOAD"

echo "Sent $RESULT notification to $BUNDLE_ID (recipeId: $RECIPE_ID)."
