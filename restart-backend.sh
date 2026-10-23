#!/usr/bin/env bash
# Restart backend Alfilaha (entrypoint: server.js)
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR" || exit 1
PORT="${PORT:-5000}"

echo "==> Menghentikan backend lama di port $PORT ..."
pkill -f "node .*server\.js" 2>/dev/null
pkill -f "server-update\.cjs" 2>/dev/null
pkill -f "server-update\.js" 2>/dev/null
sleep 2

if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" >/dev/null 2>&1
  sleep 1
fi

if curl -s -o /dev/null -m 2 "http://localhost:${PORT}/api/test" 2>/dev/null; then
  echo "==> GAGAL: port $PORT masih dipakai proses lain yang tidak bisa dihentikan."
  echo "    Cari prosesnya:  ps aux | grep -E 'node .*server'"
  exit 1
fi

echo "==> Menjalankan backend (node server.js) di port $PORT ..."
exec node server.js
