#!/bin/bash
# Matikan semua node server yang lama dan restart
echo "🔄 Menghentikan semua proses node server.js..."
pkill -f "node server.js" 2>/dev/null
pkill -f "node server-update.js" 2>/dev/null
sleep 1

echo "✅ Proses lama dihentikan"
echo "🚀 Memulai backend canonical (server-update.cjs)..."
cd /home/fauzan/alfilaha-react || exit 1
exec node server-update.cjs
