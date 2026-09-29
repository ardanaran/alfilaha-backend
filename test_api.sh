#!/bin/bash
# Jalankan script ini untuk test API backend
# Usage: bash test_api.sh

echo "=== TEST API BACKEND ==="
echo ""

# 1. Test server jalan
echo "1. Cek server running..."
RESULT=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/test 2>&1)
echo "   Status: $RESULT"
if [ "$RESULT" = "200" ]; then
  echo "   ✅ Server berjalan"
else
  echo "   ❌ Server TIDAK berjalan atau error"
  echo "   → Jalankan: cd ~/alfilaha-backend && npm start"
  exit 1
fi

echo ""

# 2. Test endpoint jadwal
echo "2. Cek endpoint /api/jadwal..."
RESULT2=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/jadwal 2>&1)
echo "   Status: $RESULT2"
if [ "$RESULT2" = "200" ]; then
  echo "   ✅ Endpoint jadwal OK"
else
  echo "   ❌ Endpoint jadwal bermasalah (status $RESULT2)"
fi

echo ""

# 3. Test endpoint santri
echo "3. Cek daftar santri..."
SANTRI=$(curl -s http://localhost:5000/api/santri-terdaftar 2>&1)
echo "   Response: $SANTRI" | head -c 200
echo ""

# 4. Test CORS dengan PATCH
echo ""
echo "4. Test CORS PATCH (simulasi dari frontend)..."
CORS_RESULT=$(curl -s -o /dev/null -w "%{http_code}" \
  -X OPTIONS \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: PATCH" \
  -H "Access-Control-Request-Headers: Authorization,Content-Type" \
  http://localhost:5000/api/tugas/1/selesai 2>&1)
echo "   CORS preflight status: $CORS_RESULT"
if [ "$CORS_RESULT" = "200" ] || [ "$CORS_RESULT" = "204" ]; then
  echo "   ✅ CORS PATCH sudah diizinkan"
else
  echo "   ❌ CORS PATCH bermasalah — restart server diperlukan"
fi

echo ""
echo "=== SELESAI ==="
echo ""
echo "Jika semua OK tapi masih gagal dari browser:"
echo "→ Buka F12 > Console di browser dan lihat error lengkapnya"
echo "→ Pastikan kamu SUDAH restart server setelah edit kode"
