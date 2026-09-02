#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly IOS_DIR="${SCRIPT_DIR}/../ios"

if [[ "$(uname -s)" == "Darwin" ]]; then
  readonly DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
  export DEVELOPER_DIR
  formatter=(xcrun swift-format)
else
  formatter=(swift format)
fi
readonly -a formatter

cd "${IOS_DIR}"
"${formatter[@]}" lint --recursive --strict \
  Foodfolio FoodfolioTests FoodfolioIntegrationTests FoodfolioUITests
