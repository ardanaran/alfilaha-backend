#!/usr/bin/env bash
# Restart backend Alfilaha
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR" || exit 1

echo "🔄 Menghentikan proses backend lama..."
pkill -f "node server.js" 2>/dev/null
pkill -f "node server-update" 2>/dev/null
sleep 1

echo "✅ Proses lama dihentikan"
echo "🚀 Memulai backend (node server.js)..."
exec node server.js
