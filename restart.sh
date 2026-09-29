#!/bin/bash
# Matikan semua node server yang lama dan restart
echo "🔄 Menghentikan semua proses node server.js..."
pkill -f "node server.js" 2>/dev/null
pkill -f "node server-update.js" 2>/dev/null
sleep 1

echo "✅ Proses lama dihentikan"
echo "🚀 Memulai server baru..."
cd ~/alfilaha-backend
node server.js
