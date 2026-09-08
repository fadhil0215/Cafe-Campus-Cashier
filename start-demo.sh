#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
PORT="${PORT:-4176}"
HOST="${HOST:-0.0.0.0}"
export PORT HOST
printf "\nCafe Campus Demo v5 — Figma UI\nDesktop: http://127.0.0.1:%s\n\n" "$PORT"
node server.mjs
