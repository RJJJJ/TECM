#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <TECM.app-or-Info.plist>" >&2
  exit 64
fi

input_path=$1
if [[ -d "$input_path" ]]; then
  plist_path="$input_path/Info.plist"
else
  plist_path=$input_path
fi

if [[ ! -f "$plist_path" ]]; then
  echo "launch metadata validation failed: Info.plist not found" >&2
  exit 1
fi

if plutil -extract UILaunchScreen json -expect dictionary -o /dev/null "$plist_path" 2>/dev/null; then
  echo "launch metadata validation passed: UILaunchScreen dictionary"
  exit 0
fi

if plutil -extract UILaunchScreens json -expect dictionary -o /dev/null "$plist_path" 2>/dev/null; then
  echo "launch metadata validation passed: UILaunchScreens dictionary"
  exit 0
fi

for storyboard_key in UILaunchStoryboardName UILaunchStoryboards; do
  if plutil -extract "$storyboard_key" raw -expect string -o - "$plist_path" 2>/dev/null |
    grep -q '[^[:space:]]'; then
    echo "launch metadata validation passed: $storyboard_key"
    exit 0
  fi
done

echo "launch metadata validation failed: no supported launch metadata" >&2
exit 1
