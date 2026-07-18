#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'checkout provenance error: %s\n' "$*" >&2
  exit 1
}

: "${GITHUB_EVENT_NAME:?GITHUB_EVENT_NAME is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"

checked_out_sha="$(git rev-parse HEAD)"
printf 'checked-out SHA: %s\n' "$checked_out_sha"
printf 'GITHUB_SHA: %s\n' "$GITHUB_SHA"
[[ "$checked_out_sha" == "$GITHUB_SHA" ]] ||
  die "git HEAD does not equal GITHUB_SHA"

case "$GITHUB_EVENT_NAME" in
  pull_request)
    : "${GITHUB_EVENT_PATH:?GITHUB_EVENT_PATH is required for pull_request}"
    read -r event_base_sha event_head_sha < <(
      python3 - "$GITHUB_EVENT_PATH" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as event_file:
    pull_request = json.load(event_file)["pull_request"]
print(pull_request["base"]["sha"], pull_request["head"]["sha"])
PY
    )
    [[ -n "$event_base_sha" && -n "$event_head_sha" ]] ||
      die "pull_request event is missing base/head SHA"

    read -r merge_sha first_parent second_parent extra_parent < <(
      git rev-list --parents -n 1 HEAD
    )
    printf 'event pull_request.base.sha: %s\n' "$event_base_sha"
    printf 'event pull_request.head.sha: %s\n' "$event_head_sha"
    printf 'synthetic merge SHA: %s\n' "$merge_sha"
    printf 'synthetic merge first parent: %s\n' "${first_parent:-}"
    printf 'synthetic merge second parent: %s\n' "${second_parent:-}"

    [[ -n "${first_parent:-}" && -n "${second_parent:-}" && -z "${extra_parent:-}" ]] ||
      die "pull_request checkout is not a two-parent synthetic merge"
    [[ "$merge_sha" == "$GITHUB_SHA" ]] ||
      die "synthetic merge SHA does not equal GITHUB_SHA"
    [[ "$first_parent" == "$event_base_sha" ]] ||
      die "synthetic merge first parent does not equal event base SHA"
    [[ "$second_parent" == "$event_head_sha" ]] ||
      die "synthetic merge second parent does not equal event head SHA"
    ;;
  push)
    printf 'push checkout provenance verified\n'
    ;;
  *)
    die "unsupported GitHub event: $GITHUB_EVENT_NAME"
    ;;
esac
