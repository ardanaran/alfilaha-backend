const mysql = require('mysql2');
require('dotenv').config();

const db = mysql.createConnection({
  host:     process.env.DB_HOST     || 'localhost',
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'db_alfilaha'
});

db.connect(err => {
  if (err) { process.stdout.write('KONEKSI GAGAL: ' + err.message + '\n'); process.exit(1); }
  process.stdout.write('KONEKSI OK\n');

  db.query('SELECT id, nama_aktivitas, penanggung_jawab, tanggal_mulai, pola_perulangan, interval_hari, status FROM activity_schedules', (e, r) => {
    process.stdout.write('\n=== JADWAL (' + (r ? r.length : 0) + ' rows) ===\n');
    if (r) r.forEach(row => process.stdout.write(JSON.stringify(row) + '\n'));

    db.query('SELECT id, schedule_id, santri_id, nama_santri, tanggal_tugas, status FROM activity_tasks', (e2, r2) => {
      process.stdout.write('\n=== TIKET (' + (r2 ? r2.length : 0) + ' rows) ===\n');
      if (r2) r2.forEach(row => process.stdout.write(JSON.stringify(row) + '\n'));

      db.query('SELECT id, nama, username, status_pendaftaran FROM pendaftar_santri', (e3, r3) => {
        process.stdout.write('\n=== SANTRI (' + (r3 ? r3.length : 0) + ' rows) ===\n');
        if (r3) r3.forEach(row => process.stdout.write(JSON.stringify(row) + '\n'));
        db.end();
        process.exit(0);
      });
    });
  });
});
