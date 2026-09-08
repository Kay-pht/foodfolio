#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly REPOSITORY_DIR="${SCRIPT_DIR}/.."
readonly DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
readonly IOS_EXPECTED_TEST_COUNT="${IOS_EXPECTED_TEST_COUNT:-79}"

if [[ ! "${IOS_EXPECTED_TEST_COUNT}" =~ ^[1-9][0-9]*$ ]]; then
  echo "IOS_EXPECTED_TEST_COUNT must be a positive integer" >&2
  exit 2
fi

export DEVELOPER_DIR

bash "${SCRIPT_DIR}/lint-ios.sh"

RESULTS_DIR="$(mktemp -d "${TMPDIR:-/tmp}/foodfolio-verify-ios.XXXXXX")"
readonly RESULTS_DIR
readonly DERIVED_DATA_PATH="${RESULTS_DIR}/DerivedData"
readonly RESULT_BUNDLE_PATH="${RESULTS_DIR}/Foodfolio.xcresult"

cleanup() {
  rm -rf -- "${RESULTS_DIR}"
}
trap cleanup EXIT

IOS_DERIVED_DATA_PATH="${DERIVED_DATA_PATH}" \
  IOS_RESULT_BUNDLE_PATH="${RESULT_BUNDLE_PATH}" \
  bash "${SCRIPT_DIR}/test-ios.sh"

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
