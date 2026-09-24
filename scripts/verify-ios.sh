#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly REPOSITORY_DIR="${SCRIPT_DIR}/.."
readonly DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
readonly IOS_EXPECTED_TEST_COUNT="${IOS_EXPECTED_TEST_COUNT:-109}"

if [[ ! "${IOS_EXPECTED_TEST_COUNT}" =~ ^[1-9][0-9]*$ ]]; then
  echo "IOS_EXPECTED_TEST_COUNT must be a positive integer" >&2
  exit 2
fi

export DEVELOPER_DIR

bash "${SCRIPT_DIR}/lint-ios.sh"
bash "${SCRIPT_DIR}/test-ios-swiftdata-migration.sh"

RESULTS_DIR="$(mktemp -d "${TMPDIR:-/tmp}/foodfolio-verify-ios.XXXXXX")"
readonly RESULTS_DIR
readonly DERIVED_DATA_PATH="${RESULTS_DIR}/DerivedData"
readonly RESULT_BUNDLE_PATH="${RESULTS_DIR}/Foodfolio.xcresult"
readonly APP_BUNDLE_PATH="${DERIVED_DATA_PATH}/Build/Products/Debug-iphonesimulator/Foodfolio.app"
readonly EXTENSION_BUNDLE_PATH="${APP_BUNDLE_PATH}/PlugIns/FoodfolioShareExtension.appex"

cleanup() {
  rm -rf -- "${RESULTS_DIR}"
}
trap cleanup EXIT

IOS_DERIVED_DATA_PATH="${DERIVED_DATA_PATH}" \
  IOS_RESULT_BUNDLE_PATH="${RESULT_BUNDLE_PATH}" \
  bash "${SCRIPT_DIR}/test-ios.sh"

verify_japanese_bundle_resource() {
  local bundle_path="$1"
  local bundle_label="$2"
  local resource_path="${bundle_path}/ja.lproj/InfoPlist.strings"

  if [[ ! -f "${resource_path}" ]]; then
    echo "${bundle_label} is missing ja.lproj/InfoPlist.strings" >&2
    exit 1
  fi
}

verify_japanese_bundle_resource "${APP_BUNDLE_PATH}" "Foodfolio.app"
verify_japanese_bundle_resource "${EXTENSION_BUNDLE_PATH}" "FoodfolioShareExtension.appex"

summary_json="$(
  xcrun xcresulttool get test-results summary \
    --path "${RESULT_BUNDLE_PATH}" \
    --compact
)"

printf '%s\n' "${summary_json}" | jq '{
  result,
  totalTestCount,
  passedTests,
  failedTests,
  skippedTests
}'

if ! printf '%s\n' "${summary_json}" | jq -e \
  --argjson expected "${IOS_EXPECTED_TEST_COUNT}" \
  '.result == "Passed"
    and .totalTestCount == $expected
    and .passedTests == $expected
    and .failedTests == 0
    and .skippedTests == 0' >/dev/null; then
  echo "iOS verification did not pass all ${IOS_EXPECTED_TEST_COUNT} expected tests" >&2
  exit 1
fi

echo "iOS verification passed all ${IOS_EXPECTED_TEST_COUNT} expected tests"
