#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <TECM.app-or-Info.plist>" >&2
  exit 64
fi

input_path=$1
if [[ -d "$input_path" ]]; then
  source_plist="$input_path/Info.plist"
else
  source_plist=$input_path
fi

if [[ ! -f "$source_plist" ]]; then
  echo "mutation test failed: Info.plist not found" >&2
  exit 1
fi

script_dir=$(cd "$(dirname "$0")" && pwd)
temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT
mutated_plist="$temp_dir/Info.plist"
cp "$source_plist" "$mutated_plist"

for key in UILaunchScreen UILaunchScreens UILaunchStoryboardName UILaunchStoryboards; do
  plutil -remove "$key" "$mutated_plist" 2>/dev/null || true
done

if "$script_dir/validate-ios-launch-metadata.sh" "$mutated_plist" >/dev/null 2>&1; then
  echo "mutation test failed: missing launch metadata was accepted" >&2
  exit 1
fi

echo "mutation test passed: missing launch metadata was rejected"
