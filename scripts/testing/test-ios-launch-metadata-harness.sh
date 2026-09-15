#!/usr/bin/env bash

set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
repository_root=$(cd "$script_dir/../.." && pwd)
source_plist=${1:-"$repository_root/TECM/Info.plist"}
validator="$script_dir/validate-ios-launch-metadata.sh"
mutation="$script_dir/test-ios-launch-metadata-mutation.sh"

if [[ ! -f "$source_plist" ]]; then
  echo "launch metadata harness failed: source Info.plist not found" >&2
  exit 1
fi

hash_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    echo "launch metadata harness failed: SHA-256 utility unavailable" >&2
    return 69
  fi
}

expect_exit() {
  local expected=$1
  shift
  local status
  set +e
  "$@" >/dev/null 2>&1
  status=$?
  set -e
  if [[ $status -ne $expected ]]; then
    echo "launch metadata harness failed: expected exit $expected, got $status" >&2
    exit 1
  fi
}

test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT
quoted_dir="$test_root/path with spaces"
mutation_tmp="$test_root/mutation temp"
mkdir -p "$quoted_dir" "$mutation_tmp"
quoted_plist="$quoted_dir/Info.plist"
cp "$source_plist" "$quoted_plist"

expect_exit 64 "$mutation"
echo "launch metadata harness passed: missing argument rejected"

set +e
"$mutation" "$quoted_dir/missing.plist" >/dev/null 2>&1
invalid_status=$?
set -e
if [[ $invalid_status -eq 0 ]]; then
  echo "launch metadata harness failed: invalid input was accepted" >&2
  exit 1
fi
echo "launch metadata harness passed: invalid input rejected"

invalid_plist="$quoted_dir/invalid Info.plist"
printf 'not a plist\n' >"$invalid_plist"
set +e
"$mutation" "$invalid_plist" >/dev/null 2>&1
invalid_plist_status=$?
set -e
if [[ $invalid_plist_status -eq 0 ]]; then
  echo "launch metadata harness failed: malformed plist was accepted" >&2
  exit 1
fi
echo "launch metadata harness passed: malformed plist rejected"

"$validator" "$quoted_plist" >/dev/null
echo "launch metadata harness passed: supported quoted input validated"

before_hash=$(hash_file "$quoted_plist")
mutation_output=$(TMPDIR="$mutation_tmp" "$mutation" "$quoted_plist" 2>&1)
if [[ "$mutation_output" != *"mutation test passed: missing launch metadata was rejected"* ]]; then
  echo "launch metadata harness failed: expected mutation rejection was not observed" >&2
  exit 1
fi
echo "launch metadata harness passed: expected mutation failure caught"

after_hash=$(hash_file "$quoted_plist")
if [[ "$before_hash" != "$after_hash" ]]; then
  echo "launch metadata harness failed: source restoration hash mismatch" >&2
  exit 1
fi
echo "launch metadata harness passed: restoration hash PASS"

if [[ -n $(find "$mutation_tmp" -mindepth 1 -print -quit) ]]; then
  echo "launch metadata harness failed: mutation temporary files remain" >&2
  exit 1
fi

rm -rf "$test_root"
trap - EXIT
if [[ -e "$test_root" ]]; then
  echo "launch metadata harness failed: cleanup did not remove test directory" >&2
  exit 1
fi
echo "launch metadata harness passed: cleanup PASS"
