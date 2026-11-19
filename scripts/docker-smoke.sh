#!/usr/bin/env bash
# Smoke test of the Adrien image: it must start, enforce its token and host check, and be able to write its search
# index into a mounted log. Usage: scripts/docker-smoke.sh <image>   (run from the root of a checkout that holds a log)
set -euo pipefail
IMAGE="${1:?usage: docker-smoke.sh <image>}"
NAME=adrien-test
TOKEN=smoke-test-token
URL=http://127.0.0.1:4310

# Always clean up, and show the container's logs when anything failed.
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then docker logs "$NAME" >&2 || true; fi
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

# The container runs as the image's node user, but the checkout belongs to the runner. Run as the runner's own uid and
# gid, so the search index can be written to .adrien/ in the mounted log, and point HOME at a writable place.
docker run -d --name "$NAME" -p 4310:4310 \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD:/log" \
  -e ADRIEN_TOKEN="$TOKEN" -e ADRIEN_ALLOWED_HOSTS=localhost \
  "$IMAGE"

ready=""
for _ in $(seq 60); do
  if [ "$(curl -fsS --max-time 5 "$URL/healthz" 2>/dev/null)" = "ok" ]; then
    ready=1
    break
  fi
  sleep 1
done
[ -n "$ready" ] || { echo "healthz did not answer ok within 60 s" >&2; exit 1; }

status_of() { curl -s --max-time 10 -o /dev/null -w '%{http_code}' "$@"; }

code=$(status_of "$URL/api/meta")
[ "$code" = "401" ] || { echo "expected 401 without a token, got $code" >&2; exit 1; }

code=$(status_of -H 'Authorization: Bearer wrong-token' "$URL/api/meta")
[ "$code" = "401" ] || { echo "expected 401 with a wrong token, got $code" >&2; exit 1; }

# The Host name is checked before the token, so an unknown name is refused even with the right token.
code=$(status_of -H "Authorization: Bearer $TOKEN" -H 'Host: evil.example' "$URL/api/meta")
[ "$code" = "403" ] || { echo "expected 403 for an unknown Host, got $code" >&2; exit 1; }

body=$(mktemp)
code=$(curl -s --max-time 10 -o "$body" -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$URL/api/meta")
if [ "$code" != "200" ] || ! grep -q '"product":"adrien"' "$body"; then
  echo "expected 200 with the token and a body naming adrien, got $code:" >&2
  cat "$body" >&2
  exit 1
fi

# Listing the decisions makes the server build its search index, which proves the mounted log is writable for the
# container user (a read-only or foreign-owned mount would fail here, not in front of a user).
code=$(status_of -H "Authorization: Bearer $TOKEN" "$URL/api/adrs")
[ "$code" = "200" ] || { echo "expected 200 from /api/adrs, got $code" >&2; exit 1; }
[ -f .adrien/index.db ] || { echo "the search index was not written to the mounted log" >&2; exit 1; }
echo "smoke test passed for $IMAGE"
