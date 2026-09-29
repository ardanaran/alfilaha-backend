const mysql = require('mysql2');
require('dotenv').config();

const db = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'db_alfilaha'
});

console.log('🔄 Memulai migrasi struktur lokasi/area...');

let migrationCompleted = false;
let categoryMigrationCompleted = false;

db.connect((err) => {
  if (err) {
    console.error('❌ Gagal koneksi ke database:', err);
    process.exit(1);
  }
  console.log('✅ Berhasil terhubung ke MySQL');

  // 1. Buat tabel kategori
  const createKategori = `
    CREATE TABLE IF NOT EXISTS kategori (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nama VARCHAR(100) NOT NULL UNIQUE,
      aktif TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  // 2. Buat tabel lokasi
  const createLokasi = `
    CREATE TABLE IF NOT EXISTS lokasi (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nama VARCHAR(100) NOT NULL UNIQUE,
      keterangan TEXT,
      aktif TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  // 3. Buat tabel kegiatan_lokasi
  const createKegiatanLokasi = `
    CREATE TABLE IF NOT EXISTS kegiatan_lokasi (
      id INT AUTO_INCREMENT PRIMARY KEY,
      lokasi_id INT NOT NULL,
      nama VARCHAR(255) NOT NULL,
      aktif TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lokasi_id) REFERENCES lokasi(id) ON DELETE CASCADE,
      UNIQUE KEY uq_lokasi_nama (lokasi_id, nama)
    )
  `;

  // 4. Update tabel tanaman - tambah lokasi_id
  const updateTanaman = `
    ALTER TABLE tanaman 
    ADD COLUMN lokasi_id INT NULL
  `;

  // 4b. Tambahkan foreign key tanaman
  const addFKTanaman = `
    ALTER TABLE tanaman 
    ADD FOREIGN KEY (lokasi_id) REFERENCES lokasi(id) ON DELETE SET NULL
  `;

  // 5. Update tabel activity_schedules - tambah kategori_id dan lokasi_id
  const updateActivitySchedules = `
    ALTER TABLE activity_schedules
    ADD COLUMN kategori_id INT NULL,
    ADD COLUMN lokasi_id INT NULL,
    ADD COLUMN jam_mulai TIME NULL,
    ADD COLUMN jam_selesai TIME NULL
  `;

  // 5b. Tambahkan foreign key secara terpisah
  const addFKActivitySchedules = `
    ALTER TABLE activity_schedules
    ADD FOREIGN KEY (kategori_id) REFERENCES kategori(id) ON DELETE SET NULL,
    ADD FOREIGN KEY (lokasi_id) REFERENCES lokasi(id) ON DELETE SET NULL
  `;

  // 6. Buat tabel aktivitas_tanaman (relasi many-to-many)
  const createAktivitasTanaman = `
    CREATE TABLE IF NOT EXISTS aktivitas_tanaman (
      aktivitas_id INT NOT NULL,
      tanaman_id INT NOT NULL,
      PRIMARY KEY (aktivitas_id, tanaman_id),
      FOREIGN KEY (aktivitas_id) REFERENCES activity_schedules(id) ON DELETE CASCADE,
      FOREIGN KEY (tanaman_id) REFERENCES tanaman(id) ON DELETE CASCADE
    )
  `;

  // 7. Buat tabel aktivitas_santri (relasi many-to-many)
  const createAktivitasSantri = `
    CREATE TABLE IF NOT EXISTS aktivitas_santri (
      aktivitas_id INT NOT NULL,
      santri_id INT NOT NULL,
      PRIMARY KEY (aktivitas_id, santri_id),
      FOREIGN KEY (aktivitas_id) REFERENCES activity_schedules(id) ON DELETE CASCADE,
      FOREIGN KEY (santri_id) REFERENCES pendaftar_santri(id) ON DELETE CASCADE
    )
  `;

  // Eksekusi migrasi secara sequential
  const migrations = [
    { name: 'kategori', sql: createKategori },
    { name: 'lokasi', sql: createLokasi },
    { name: 'kegiatan_lokasi', sql: createKegiatanLokasi },
    { name: 'tanaman_lokasi_id', sql: updateTanaman },
    { name: 'tanaman_fk', sql: addFKTanaman },
    { name: 'activity_schedules_updates', sql: updateActivitySchedules },
    { name: 'activity_schedules_fk', sql: addFKActivitySchedules },
    { name: 'aktivitas_tanaman', sql: createAktivitasTanaman },
    { name: 'aktivitas_santri', sql: createAktivitasSantri },
  ];

  function runMigrations(index) {
    if (index >= migrations.length) {
      console.log('✅ Semua migrasi selesai!');
      // Jangan tutup koneksi dulu, jalankan migrasi kategori dulu
      if (!migrationCompleted && !categoryMigrationCompleted) {
        migrationCompleted = true;
        setTimeout(() => {
          migrateExistingCategories();
        }, 500);
      }
      return;
    }

    const migration = migrations[index];
    console.log(`🔄 Menjalankan: ${migration.name}...`);

    db.query(migration.sql, (err) => {
      if (err) {
        // Ignore error jika kolom sudah ada
        if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_TABLE_EXISTS_ERROR' || err.code === 'ER_CANT_CREATE_TABLE') {
          console.log(`  ⚠️  ${migration.name} sudah ada, skip...`);
        } else {
          console.error(`  ❌ Gagal ${migration.name}:`, err.message);
        }
      } else {
        console.log(`  ✅ ${migration.name} berhasil dibuat/diupdate`);
      }
      runMigrations(index + 1);
    });
  }

  // 8. Migrasi kategori dari data yang sudah ada
  function migrateExistingCategories() {
    if (categoryMigrationCompleted) {
      console.log('  ℹ️  Migrasi kategori sudah dijalankan, skip...');
      return;
    }
    
    categoryMigrationCompleted = true;
    console.log('🔄 Migrasi kategori dari jadwal yang sudah ada...');
    
    // Ambil semua kategori unik dari activity_schedules
    db.query('SELECT DISTINCT kategori FROM activity_schedules WHERE kategori IS NOT NULL', (err, results) => {
      if (err) {
        console.error('❌ Gagal mengambil kategori yang ada:', err.message);
        db.end();
        return;
      }

      if (results.length === 0) {
        console.log('  ℹ️  Tidak ada kategori yang perlu dimigrasi');
        db.end();
        return;
      }

      // Cek dan insert kategori secara async
      const kategoriNames = results.map(r => r.kategori);
      let processedCount = 0;
      
      kategoriNames.forEach((kategoriName) => {
        // Cek apakah kategori sudah ada di tabel kategori
        db.query('SELECT id FROM kategori WHERE nama = ?', [kategoriName], (err, catResults) => {
          if (err) {
            console.error(`  ❌ Gagal cek kategori ${kategoriName}:`, err.message);
          } else if (catResults.length === 0) {
            // Insert kategori baru
            db.query('INSERT INTO kategori (nama) VALUES (?)', [kategoriName], (err) => {
              if (err) {
                console.error(`  ❌ Gagal insert kategori ${kategoriName}:`, err.message);
              } else {
                console.log(`  ✅ Kategori "${kategoriName}" ditambahkan`);
              }
            });
          } else {
            console.log(`  ℹ️  Kategori "${kategoriName}" sudah ada`);
          }
          
          processedCount++;
          if (processedCount === kategoriNames.length) {
            // Semua kategori diproses, lanjut hubungkan ke jadwal
            linkCategoriesToSchedules(kategoriNames);
          }
        });
      });
    });
  }

  function linkCategoriesToSchedules(kategoriNames) {
    db.query('SELECT id, nama FROM kategori', (err, kategoriMap) => {
      if (err) {
        console.error('❌ Gagal mengambil kategori map:', err.message);
        db.end();
        return;
      }

      const kategoriIdMap = {};
      kategoriMap.forEach(k => {
        kategoriIdMap[k.nama] = k.id;
      });

      let updated = 0;
      let processedCount = 0;
      
      kategoriNames.forEach((kategoriName) => {
        const kategoriId = kategoriIdMap[kategoriName];
        if (kategoriId) {
          db.query('UPDATE activity_schedules SET kategori_id = ? WHERE kategori = ?', [kategoriId, kategoriName], (err) => {
            if (err) {
              console.error(`  ❌ Gagal update kategori_id untuk kategori ${kategoriName}:`, err.message);
            } else {
              updated++;
            }
            
            processedCount++;
            if (processedCount === kategoriNames.length) {
              console.log(`  ✅ ${updated} jadwal dihubungkan ke kategori baru`);
              console.log('✅ Migrasi kategori selesai!');
              db.end();
            }
          });
        } else {
          processedCount++;
          if (processedCount === kategoriNames.length) {
            console.log(`  ✅ ${updated} jadwal dihubungkan ke kategori baru`);
            console.log('✅ Migrasi kategori selesai!');
            db.end();
          }
        }
      });
    });
  }

  // Jalankan migrasi
  runMigrations(0);

  // Jalankan migrasi kategori setelah semua tabel selesai
  setTimeout(() => {
    migrateExistingCategories();
  }, 2000);
});