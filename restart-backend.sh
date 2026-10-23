#!/usr/bin/env bash
# Restart backend Alfilaha ke versi terbaru (canonical server-update.cjs).
# Jalankan:  bash ~/alfilaha-backend/restart-backend.sh
# Proses lama dihentikan lebih dulu, lalu server-update.cjs versi terbaru dinyalakan.
# CATATAN: entrypoint resmi ada di repo alfilaha-react. server.js lama punya
# route duplikat yang men-shadow server-update.cjs, jadi tidak dipakai lagi.

REPO_DIR="/home/fauzan/alfilaha-react"
cd "$REPO_DIR" || exit 1
PORT="${PORT:-5000}"

echo "==> Menghentikan backend lama di port $PORT ..."
pkill -f "node .*server\.js" 2>/dev/null
pkill -f "server-update\.cjs" 2>/dev/null
sleep 2

if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" >/dev/null 2>&1
  sleep 1
fi

if curl -s -o /dev/null -m 2 "http://localhost:${PORT}/api/jadwal"; then
  echo "==> GAGAL: port $PORT masih dipakai proses lain yang tidak bisa dihentikan."
  echo "    Cari prosesnya:  ps aux | grep -E 'node .*server'"
  exit 1
fi

echo "==> Menjalankan backend canonical (server-update.cjs) di port $PORT ..."
exec node server-update.cjs