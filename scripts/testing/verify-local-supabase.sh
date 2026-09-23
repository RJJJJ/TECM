#!/usr/bin/env bash
set -euo pipefail

status_json="$(supabase status -o json)"
api_url="$(jq -er '.API_URL' <<<"$status_json")"

case "$api_url" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "Refusing non-loopback Supabase API endpoint" >&2; exit 1 ;;
esac

container_ids="$(docker ps --filter 'name=supabase_' --quiet)"
test -n "$container_ids"

host_ips="$(while IFS= read -r container_id; do
  docker inspect --format '{{json .NetworkSettings.Ports}}' "$container_id"
done <<<"$container_ids" | jq -r '.[]?[]?.HostIp // empty')"
test -n "$host_ips"

while IFS= read -r host_ip; do
  case "$host_ip" in
    127.0.0.1|::1) ;;
    *) echo "Refusing non-loopback Supabase published port" >&2; exit 1 ;;
  esac
done <<<"$host_ips"

for attempt in $(seq 1 20); do
  if curl --fail --silent --show-error "$api_url/auth/v1/health" >/dev/null; then
    break
  fi
  test "$attempt" -lt 20
  sleep 2
done
printf '%s\n' 'Supabase started' 'required local endpoints healthy' 'project is local-only'
