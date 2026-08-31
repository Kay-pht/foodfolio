#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly IOS_DIR="${SCRIPT_DIR}/../ios"
readonly DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
readonly IOS_DESTINATION="${IOS_DESTINATION:-platform=iOS Simulator,name=iPhone 17 Pro}"
readonly IOS_DERIVED_DATA_PATH="${IOS_DERIVED_DATA_PATH:-${IOS_DIR}/.derived-data}"
readonly IOS_PARALLEL_WORKERS="${IOS_PARALLEL_WORKERS:-2}"

if [[ ! "${IOS_PARALLEL_WORKERS}" =~ ^[1-9][0-9]*$ ]]; then
  echo "IOS_PARALLEL_WORKERS must be a positive integer" >&2
  exit 2
fi

export DEVELOPER_DIR

cd "${IOS_DIR}"

xcodegen generate --spec project.yml

xcodebuild -quiet -project Foodfolio.xcodeproj -scheme Foodfolio \
  -destination "${IOS_DESTINATION}" \
  -derivedDataPath "${IOS_DERIVED_DATA_PATH}" \
  CODE_SIGNING_ALLOWED=NO build-for-testing

xcodebuild -quiet -project Foodfolio.xcodeproj -scheme Foodfolio \
  -destination "${IOS_DESTINATION}" \
  -derivedDataPath "${IOS_DERIVED_DATA_PATH}" \
  CODE_SIGNING_ALLOWED=NO \
  -parallel-testing-enabled YES \
  -parallel-testing-worker-count "${IOS_PARALLEL_WORKERS}" \
  test-without-building
