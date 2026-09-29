const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = './uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });
const JWT_SECRET = process.env.JWT_SECRET || 'alfilaha_super_secret_key_2026';
const app = express();
const allowedOrigins = ['http://localhost:5173', 'https://alfilaha.id']; 

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept']
}));
app.use(express.json());
app.use('/uploads', express.static('uploads'));

const db = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'db_alfilaha'
});

db.connect((err) => {
  if (err) { console.error('❌ Gagal koneksi ke database:', err); return; }
  console.log('✅ Berhasil terhubung ke MySQL (db_alfilaha)');
  
  const tables = [
    `CREATE TABLE IF NOT EXISTS reservasi (id INT AUTO_INCREMENT PRIMARY KEY, nama VARCHAR(100) NOT NULL, whatsapp VARCHAR(20) NOT NULL, email VARCHAR(100), instansi VARCHAR(100), tanggal VARCHAR(50) NOT NULL, jumlah VARCHAR(100) NOT NULL, pesan TEXT, status VARCHAR(20) DEFAULT 'Pending')`,
    `CREATE TABLE IF NOT EXISTS paket_wisata (id INT AUTO_INCREMENT PRIMARY KEY, nama_paket VARCHAR(100) NOT NULL, harga VARCHAR(50) NOT NULL, deskripsi TEXT, gambar VARCHAR(255))`,
    `CREATE TABLE IF NOT EXISTS events (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255) NOT NULL, category VARCHAR(100) NOT NULL, date VARCHAR(100) NOT NULL, description TEXT, image VARCHAR(255))`,
    `CREATE TABLE IF NOT EXISTS blogs (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255) NOT NULL, date VARCHAR(100) NOT NULL, excerpt TEXT, content LONGTEXT, image VARCHAR(255))`,
    `CREATE TABLE IF NOT EXISTS appointments (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, number VARCHAR(20), email VARCHAR(100) NOT NULL, address TEXT, message TEXT, status VARCHAR(20) DEFAULT 'Pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS admin_users (id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(50) NOT NULL UNIQUE, password VARCHAR(255) NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS galeri (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255) NOT NULL, description TEXT, category VARCHAR(100) NOT NULL, image_url VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS pendaftar_santri (id INT AUTO_INCREMENT PRIMARY KEY, nama VARCHAR(255) NOT NULL, tempat_lahir VARCHAR(100) NOT NULL, tanggal_lahir DATE NOT NULL, jenis_kelamin ENUM('L', 'P') NOT NULL, alamat TEXT NOT NULL, no_wa VARCHAR(20) NOT NULL, email VARCHAR(255), username VARCHAR(100) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, status_pendaftaran ENUM('Menunggu Verifikasi', 'Diterima', 'Ditolak') DEFAULT 'Menunggu Verifikasi', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
  ,
    `CREATE TABLE IF NOT EXISTS layanan (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255) NOT NULL, description TEXT, image VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS tanaman (id INT AUTO_INCREMENT PRIMARY KEY, nama VARCHAR(255) NOT NULL, jenis VARCHAR(100), lokasi VARCHAR(255), deskripsi TEXT, gambar VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(50) NOT NULL UNIQUE, password VARCHAR(255) NOT NULL, nama_lengkap VARCHAR(100), role VARCHAR(50) DEFAULT 'user')`,
    `CREATE TABLE IF NOT EXISTS log_perawatan (id INT AUTO_INCREMENT PRIMARY KEY, tanaman_id INT NOT NULL, santri_id INT NULL, jenis_tindakan ENUM('siram', 'pupuk', 'panen') NOT NULL, nama_perawat VARCHAR(255), role_perawat VARCHAR(50), waktu_tindakan TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (tanaman_id) REFERENCES tanaman(id) ON DELETE CASCADE, FOREIGN KEY (santri_id) REFERENCES pendaftar_santri(id) ON DELETE SET NULL)`,
    `CREATE TABLE IF NOT EXISTS foto_perkembangan (id INT AUTO_INCREMENT PRIMARY KEY, tanaman_id INT NOT NULL, santri_id INT NOT NULL, gambar VARCHAR(255) NOT NULL, waktu_upload TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (tanaman_id) REFERENCES tanaman(id) ON DELETE CASCADE, FOREIGN KEY (santri_id) REFERENCES pendaftar_santri(id) ON DELETE CASCADE)`
  ];
  
  tables.forEach(q => db.query(q, (err) => { if (err) console.error(err); }));
  
  // Update paket_wisata table if needed
  db.query("ALTER TABLE paket_wisata ADD COLUMN gambar VARCHAR(255)", (err) => {
    // Ignore error if column already exists
  });

  // ── AUTO-MIGRASI schema (idempotent, aman dijalankan ulang) ─────────────
  
  // Cek jika tabel riwayat_perawatan ada dan migrasi ke log_perawatan
  db.query("SHOW TABLES LIKE 'riwayat_perawatan'", (err, rows) => {
    if (err) { console.error('[Migrasi] cek riwayat_perawatan gagal:', err.message); return; }
    if (rows && rows.length > 0) {
      console.log('[Migrasi] Tabel riwayat_perawatan ditemukan, mencoba migrasi ke log_perawatan...');
      
      // Coba drop semua foreign key constraints yang bermasalah
      db.query("ALTER TABLE riwayat_perawatan DROP FOREIGN KEY riwayat_perawatan_ibfk_1", (err1) => {
        if (err1) console.log('[Migrasi] Tidak bisa drop riwayat_perawatan_ibfk_1:', err1.message);
        else console.log('[Migrasi] Foreign key riwayat_perawatan_ibfk_1 dihapus ✅');
      });
      
      db.query("ALTER TABLE riwayat_perawatan DROP FOREIGN KEY riwayat_perawatan_ibfk_2", (err2) => {
        if (err2) console.log('[Migrasi] Tidak bisa drop riwayat_perawatan_ibfk_2:', err2.message);
        else console.log('[Migrasi] Foreign key riwayat_perawatan_ibfk_2 dihapus ✅');
      });
      
      // Migrasi data dari riwayat_perawatan ke log_perawatan
      db.query("INSERT INTO log_perawatan (tanaman_id, santri_id, jenis_tindakan, nama_perawat, role_perawat, waktu_tindakan) SELECT tanaman_id, user_id as santri_id, jenis_aksi as jenis_tindakan, nama_perawat, role_perawat, waktu_aksi as waktu_tindakan FROM riwayat_perawatan WHERE NOT EXISTS (SELECT 1 FROM log_perawatan WHERE log_perawatan.tanaman_id = riwayat_perawatan.tanaman_id AND log_perawatan.waktu_tindakan = riwayat_perawatan.waktu_aksi)", (err3) => {
        if (err3) console.log('[Migrasi] Migrasi data gagal:', err3.message);
        else console.log('[Migrasi] Data berhasil dimigrasi dari riwayat_perawatan ke log_perawatan ✅');
      });
      
      // Drop tabel lama setelah migrasi berhasil
      setTimeout(() => {
        db.query("DROP TABLE IF EXISTS riwayat_perawatan", (err4) => {
          if (err4) console.log('[Migrasi] Tidak bisa drop tabel riwayat_perawatan:', err4.message);
          else console.log('[Migrasi] Tabel riwayat_perawatan berhasil dihapus ✅');
        });
      }, 2000);
    }
  });
  
  // Cek dan tambahkan kolom yang hilang di log_perawatan
  db.query("SHOW COLUMNS FROM log_perawatan LIKE 'nama_perawat'", (err, rows) => {
    if (err) { console.error('[Migrasi] cek nama_perawat gagal:', err.message); return; }
    if (!rows || rows.length === 0) {
      db.query("ALTER TABLE log_perawatan ADD COLUMN nama_perawat VARCHAR(255)", (err2) => {
        if (err2) console.error('[Migrasi] tambah nama_perawat gagal:', err2.message);
        else console.log('[Migrasi] log_perawatan: nama_perawat ditambah ✅');
      });
    }
  });
  
  db.query("SHOW COLUMNS FROM log_perawatan LIKE 'role_perawat'", (err, rows) => {
    if (err) { console.error('[Migrasi] cek role_perawat gagal:', err.message); return; }
    if (!rows || rows.length === 0) {
      db.query("ALTER TABLE log_perawatan ADD COLUMN role_perawat VARCHAR(50)", (err2) => {
        if (err2) console.error('[Migrasi] tambah role_perawat gagal:', err2.message);
        else console.log('[Migrasi] log_perawatan: role_perawat ditambah ✅');
      });
    }
  });
  
  // log_perawatan: kolom perawat_id → santri_id dan boleh NULL (utk internal user)
  db.query("SHOW COLUMNS FROM log_perawatan LIKE 'perawat_id'", (err, rows) => {
    if (err) { console.error('[Migrasi] cek perawat_id gagal:', err.message); return; }
    if (rows && rows.length > 0) {
      db.query("ALTER TABLE log_perawatan CHANGE perawat_id santri_id INT NULL", (err2) => {
        if (err2) console.error('[Migrasi] rename perawat_id->santri_id gagal:', err2.message);
        else console.log('[Migrasi] log_perawatan: perawat_id -> santri_id (nullable) ✅');
      });
    } else {
      // Pastikan santri_id nullable jika kolom sudah bernama santri_id
      db.query("SHOW COLUMNS FROM log_perawatan LIKE 'santri_id'", (e3, r3) => {
        if (r3 && r3.length > 0 && r3[0].Null === 'NO') {
          db.query("ALTER TABLE log_perawatan MODIFY santri_id INT NULL", (e4) => {
            if (e4) console.error('[Migrasi] santri_id nullable gagal:', e4.message);
            else console.log('[Migrasi] log_perawatan: santri_id dibuat nullable ✅');
          });
        }
      });
    }
  });

  // admin_users: pastikan kolom nama_lengkap & role ada
  db.query("SHOW COLUMNS FROM admin_users LIKE 'nama_lengkap'", (err, rows) => {
    if (err) return;
    if (!rows || rows.length === 0) {
      db.query("ALTER TABLE admin_users ADD COLUMN nama_lengkap VARCHAR(100), ADD COLUMN role VARCHAR(50) DEFAULT 'Petugas'", (err2) => {
        if (err2) console.error('[Migrasi] tambah kolom admin_users gagal:', err2.message);
        else console.log('[Migrasi] admin_users: ditambah nama_lengkap & role ✅');
      });
    }
  });
});

app.get('/api/test', (req, res) => {
  res.json({ message: 'Halo!', endpoints: ['GET /api/jadwal', 'POST /api/jadwal', 'GET /api/santri-terdaftar'] });
});

// Endpoint khusus untuk membersihkan database dari tabel yang bermasalah
app.post('/api/cleanup-database', (req, res) => {
  console.log('[Cleanup] Memulai pembersihan database...');
  
  // Cek dan hapus tabel riwayat_perawatan jika ada
  db.query("SHOW TABLES LIKE 'riwayat_perawatan'", (err, rows) => {
    if (err) {
      console.error('[Cleanup] Error cek tabel riwayat_perawatan:', err.message);
      return res.status(500).json({ error: err.message });
    }
    
    if (rows && rows.length > 0) {
      console.log('[Cleanup] Tabel riwayat_perawatan ditemukan, menghapus...');
      
      // Drop foreign keys dulu
      db.query("ALTER TABLE riwayat_perawatan DROP FOREIGN KEY IF EXISTS riwayat_perawatan_ibfk_1", (err1) => {
        if (err1) console.log('[Cleanup] Tidak bisa drop riwayat_perawatan_ibfk_1:', err1.message);
      });
      
      db.query("ALTER TABLE riwayat_perawatan DROP FOREIGN KEY IF EXISTS riwayat_perawatan_ibfk_2", (err2) => {
        if (err2) console.log('[Cleanup] Tidak bisa drop riwayat_perawatan_ibfk_2:', err2.message);
      });
      
      // Drop tabel
      setTimeout(() => {
        db.query("DROP TABLE IF EXISTS riwayat_perawatan", (err3) => {
          if (err3) {
            console.error('[Cleanup] Error drop tabel riwayat_perawatan:', err3.message);
            return res.status(500).json({ error: err3.message });
          }
          console.log('[Cleanup] Tabel riwayat_perawatan berhasil dihapus ✅');
          res.json({ message: 'Database berhasil dibersihkan', status: 'success' });
        });
      }, 1000);
    } else {
      console.log('[Cleanup] Tabel riwayat_perawatan tidak ditemukan');
      res.json({ message: 'Tabel riwayat_perawatan tidak ditemukan', status: 'clean' });
    }
  });
});

// Test endpoint khusus jadwal
app.get('/api/jadwal-test', (req, res) => {
  db.query('SHOW TABLES LIKE "activity_schedules"', (err, r1) => {
    db.query('SHOW TABLES LIKE "activity_tasks"', (err2, r2) => {
      db.query('SELECT COUNT(*) as c FROM pendaftar_santri', (err3, r3) => {
        res.json({
          activity_schedules_exists: r1 && r1.length > 0,
          activity_tasks_exists: r2 && r2.length > 0,
          total_santri: r3 && r3[0] ? r3[0].c : 0,
          server: 'OK'
        });
      });
    });
  });
});

// ==========================================
// API PENDAFTARAN SANTRI
// ==========================================
app.post("/api/pendaftaran", async (req, res) => {
  const { nama, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat, no_wa, email, username, password } = req.body;
  try {
    db.query("SELECT * FROM pendaftar_santri WHERE username = ?", [username], async (err, results) => {
      if (err) return res.status(500).json({ message: "Terjadi kesalahan server saat cek username." });
      if (results.length > 0) return res.status(400).json({ message: "Username sudah digunakan." });

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const sql = `INSERT INTO pendaftar_santri (nama, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat, no_wa, email, username, password) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      db.query(sql, [nama, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat, no_wa, email, username, hashedPassword], (err, insertResult) => {
        if (err) return res.status(500).json({ message: "Gagal menyimpan data ke database.", error: err.message });
        const token = jwt.sign({ id: insertResult.insertId, username }, JWT_SECRET, { expiresIn: '30d' });
        res.status(201).json({ message: "Pendaftaran Berhasil", token });
      });
    });
  } catch (err) { res.status(500).json({ message: "Terjadi kesalahan server." }); }
});

// LOGIN SANTRI
app.post("/api/pendaftaran/login", (req, res) => {
  const { username, password } = req.body;
  db.query("SELECT * FROM pendaftar_santri WHERE username = ?", [username], async (err, results) => {
    if (err) return res.status(500).json({ message: "Terjadi kesalahan server saat login." });
    if (results.length === 0) return res.status(401).json({ message: "Username tidak ditemukan!" });
    
    const user = results[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Password salah!" });
    
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ 
      message: "Login berhasil", 
      token, 
      user: { 
        id: user.id, 
        nama: user.nama, 
        username: user.username, 
        status_pendaftaran: user.status_pendaftaran 
      } 
    });
  });
});

const authenticateSantriToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: "Akses ditolak. Belum login." });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Token tidak valid atau sudah kadaluarsa." });
    
    // Try to fetch santri data first
    db.query("SELECT id, nama, username, status_pendaftaran FROM pendaftar_santri WHERE id = ?", [user.id], (err, santriResults) => {
      if (err) return res.status(500).json({ message: "Terjadi kesalahan database." });
      
      if (santriResults.length > 0) {
        // This is a santri token
        req.user = {
          ...user,
          ...santriResults[0],
          userType: 'santri'
        };
        next();
      } else {
        // Try to fetch internal user data
        db.query("SELECT id, username, nama_lengkap, role FROM admin_users WHERE id = ?", [user.id], (err, adminResults) => {
          if (err) return res.status(500).json({ message: "Terjadi kesalahan database." });
          
          if (adminResults.length > 0) {
            // This is an internal user token
            req.user = {
              ...user,
              ...adminResults[0],
              userType: 'internal',
              status_pendaftaran: 'Diterima' // Internal users are always "accepted"
            };
            next();
          } else {
            return res.status(404).json({ message: "User tidak ditemukan." });
          }
        });
      }
    });
  });
};

// Middleware to validate santri status for care actions
const validateSantriStatus = (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Akses ditolak. Belum login." });
  
  if (req.user.status_pendaftaran !== 'Diterima') {
    return res.status(403).json({ 
      message: "Maaf, Anda belum diterima sebagai santri. Silakan tunggu konfirmasi dari admin.",
      status: req.user.status_pendaftaran
    });
  }
  
  next();
};

app.get("/api/pendaftaran/status", authenticateSantriToken, (req, res) => {
  const sql = "SELECT id, nama, tempat_lahir, DATE_FORMAT(tanggal_lahir, '%Y-%m-%d') as tanggal_lahir, jenis_kelamin, alamat, no_wa, email, username, status_pendaftaran FROM pendaftar_santri WHERE id = ?";
  db.query(sql, [req.user.id], (err, results) => {
    if (err) return res.status(500).json({ message: "Terjadi kesalahan." });
    if (results.length === 0) return res.status(404).json({ message: "Data tidak ditemukan." });
    res.json(results[0]);
  });
});

app.get('/api/pendaftar_santri', (req, res) => {
  db.query("SELECT * FROM pendaftar_santri ORDER BY id DESC", (err, results) => {
    res.json(results);
  });
});
app.put('/api/pendaftar_santri/:id/status', (req, res) => {
  db.query("UPDATE pendaftar_santri SET status_pendaftaran = ? WHERE id = ?", [req.body.status, req.params.id], () => {
    res.json({ message: "Berhasil" });
  });
});
app.delete('/api/pendaftar_santri/:id', (req, res) => {
  db.query("DELETE FROM pendaftar_santri WHERE id = ?", [req.params.id], () => {
    res.json({ message: "Berhasil" });
  });
});

// GALERI
const GALERI_CATEGORIES = [
  "Lahan Pertanian", "Kegiatan Santri", "Edukasi",
  "Panen", "Camping", "Kegiatan Masyarakat",
];

// Hapus file gambar di ./uploads (dipakai saat ganti/hapus foto agar tidak ada file sisa)
const removeUpload = (filename) => {
  if (!filename) return;
  try {
    const filepath = path.join('./uploads', path.basename(filename));
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      console.log("File gambar dihapus:", filepath);
    }
  } catch (error) {
    console.error("Gagal menghapus file gambar:", error.message);
  }
};

app.get('/api/galeri', (req, res) => {
  db.query("SELECT * FROM galeri ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});
app.post('/api/galeri', upload.single('image'), (req, res) => {
  const { title, description, category } = req.body || {};
  const image_url = req.file ? req.file.filename : null;

  if (!image_url) return res.status(400).json({ error: "Gambar wajib diunggah" });
  if (!title || !String(title).trim()) return res.status(400).json({ error: "Judul wajib diisi" });
  if (!GALERI_CATEGORIES.includes(category)) return res.status(400).json({ error: "Kategori tidak valid" });

  db.query("INSERT INTO galeri (title, description, category, image_url) VALUES (?, ?, ?, ?)", [String(title).trim(), description || null, category, image_url], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ message: "Foto berhasil ditambahkan", id: results?.insertId });
  });
});

// Ubah Foto Galeri (gambar opsional - bila tidak dikirim, gambar lama dipertahankan)
app.put('/api/galeri/:id', upload.single('image'), (req, res) => {
  const { title, description, category } = req.body || {};

  if (!title || !String(title).trim()) return res.status(400).json({ error: "Judul wajib diisi" });
  if (!GALERI_CATEGORIES.includes(category)) return res.status(400).json({ error: "Kategori tidak valid" });

  db.query("SELECT image_url FROM galeri WHERE id = ?", [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!rows || rows.length === 0) return res.status(404).json({ error: "Foto tidak ditemukan" });

    const oldImage = rows[0].image_url;
    const newImage = req.file ? req.file.filename : null;
    // Hanya sentuh kolom description bila memang dikirim, supaya deskripsi lama tidak ikut terhapus
    const hasDescription = Object.prototype.hasOwnProperty.call(req.body, "description");

    const finish = (err, imageUrl) => {
      if (err) {
        if (newImage) removeUpload(newImage);
        return res.status(500).json({ error: err.message });
      }
      if (newImage) removeUpload(oldImage);
      res.json({ message: "Foto berhasil diperbarui", image_url: imageUrl });
    };

    if (newImage) {
      db.query(
        "UPDATE galeri SET title = ?, category = ?, image_url = ? WHERE id = ?",
        [String(title).trim(), category, newImage, req.params.id],
        (err) => finish(err, newImage),
      );
    } else if (hasDescription) {
      db.query(
        "UPDATE galeri SET title = ?, description = ?, category = ? WHERE id = ?",
        [String(title).trim(), description || null, category, req.params.id],
        (err) => finish(err, oldImage),
      );
    } else {
      db.query(
        "UPDATE galeri SET title = ?, category = ? WHERE id = ?",
        [String(title).trim(), category, req.params.id],
        (err) => finish(err, oldImage),
      );
    }
  });
});

app.delete('/api/galeri/:id', (req, res) => {
  db.query("SELECT image_url FROM galeri WHERE id = ?", [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: "Foto tidak ditemukan, mungkin sudah dihapus" });
    }

    const imageUrl = rows[0].image_url;
    db.query("DELETE FROM galeri WHERE id = ?", [req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      removeUpload(imageUrl);
      res.json({ message: "Foto berhasil dihapus" });
    });
  });
});

// RESERVASI
app.get('/api/reservasi', (req, res) => {
  db.query("SELECT * FROM reservasi ORDER BY id DESC", (err, results) => {
    res.json(results);
  });
});
app.post('/api/reservasi', (req, res) => {
  const { nama, whatsapp, email, instansi, tanggal, jumlah, pesan } = req.body;
  db.query("INSERT INTO reservasi (nama, whatsapp, email, instansi, tanggal, jumlah, pesan) VALUES (?, ?, ?, ?, ?, ?, ?)", [nama, whatsapp, email, instansi, tanggal, jumlah, pesan], () => {
    res.json({ message: "Berhasil" });
  });
});
app.put('/api/reservasi/:id/status', (req, res) => {
  db.query("UPDATE reservasi SET status = ? WHERE id = ?", [req.body.status, req.params.id], () => {
    res.json({ message: "Berhasil" });
  });
});
app.delete('/api/reservasi/:id', (req, res) => {
  db.query("DELETE FROM reservasi WHERE id = ?", [req.params.id], () => {
    res.json({ message: "Berhasil" });
  });
});

// PAKET WISATA
app.get('/api/paket', (req, res) => {
  db.query("SELECT * FROM paket_wisata", (err, results) => {
    res.json(results);
  });
});
app.put('/api/paket/:id', upload.single('gambar'), (req, res) => {
  const { nama_paket, harga, deskripsi } = req.body;
  if (req.file) {
    db.query("UPDATE paket_wisata SET nama_paket = ?, harga = ?, deskripsi = ?, gambar = ? WHERE id = ?", [nama_paket, harga, deskripsi, req.file.filename, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Berhasil" });
    });
  } else {
    db.query("UPDATE paket_wisata SET nama_paket = ?, harga = ?, deskripsi = ? WHERE id = ?", [nama_paket, harga, deskripsi, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Berhasil" });
    });
  }
});
app.post('/api/paket', upload.single('gambar'), (req, res) => {
  const { nama_paket, harga, deskripsi } = req.body;
  const gambar = req.file ? req.file.filename : null;
  db.query("INSERT INTO paket_wisata (nama_paket, harga, deskripsi, gambar) VALUES (?, ?, ?, ?)", [nama_paket, harga, deskripsi, gambar], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Berhasil" });
  });
});
app.delete('/api/paket/:id', (req, res) => {
  db.query("DELETE FROM paket_wisata WHERE id = ?", [req.params.id], () => {
    res.json({ message: "Berhasil" });
  });
});

// EVENTS
app.get('/api/events', (req, res) => {
  db.query("SELECT * FROM events ORDER BY id DESC", (err, results) => {
    res.json(results);
  });
});
app.post('/api/events', upload.single('image'), (req, res) => {
  const { title, category, date, description } = req.body;
  db.query("INSERT INTO events (title, category, date, description, image) VALUES (?, ?, ?, ?, ?)", [title, category, date, description, req.file ? req.file.filename : null], () => {
    res.json({ message: "Berhasil" });
  });
});
app.put('/api/events/:id', upload.single('image'), (req, res) => {
  const { title, category, date, description } = req.body;
  if (req.file) {
    db.query("UPDATE events SET title=?, category=?, date=?, description=?, image=? WHERE id=?", [title, category, date, description, req.file.filename, req.params.id], () => {
      res.json({ message: "Berhasil" });
    });
  } else {
    db.query("UPDATE events SET title=?, category=?, date=?, description=? WHERE id=?", [title, category, date, description, req.params.id], () => {
      res.json({ message: "Berhasil" });
    });
  }
});
app.delete('/api/events/:id', (req, res) => {
  db.query("DELETE FROM events WHERE id = ?", [req.params.id], () => {
    res.json({ message: "Berhasil" });
  });
});

// BLOGS
app.get('/api/blogs', (req, res) => {
  db.query("SELECT * FROM blogs ORDER BY id DESC", (err, results) => {
    res.json(results);
  });
});
app.post('/api/blogs', upload.single('image'), (req, res) => {
  const { title, date, excerpt, content } = req.body;
  const image = req.file ? req.file.filename : null;
  db.query("INSERT INTO blogs (title, date, excerpt, content, image) VALUES (?, ?, ?, ?, ?)", [title, date, excerpt, content, image], () => {
    res.json({ message: "Berhasil" });
  });
});
app.put('/api/blogs/:id', upload.single('image'), (req, res) => {
  const { title, date, excerpt, content } = req.body;
  if (req.file) {
    db.query("UPDATE blogs SET title=?, date=?, excerpt=?, content=?, image=? WHERE id=?", [title, date, excerpt, content, req.file.filename, req.params.id], () => {
      res.json({ message: "Berhasil" });
    });
  } else {
    db.query("UPDATE blogs SET title=?, date=?, excerpt=?, content=? WHERE id=?", [title, date, excerpt, content, req.params.id], () => {
      res.json({ message: "Berhasil" });
    });
  }
});
app.delete('/api/blogs/:id', (req, res) => {
  db.query("DELETE FROM blogs WHERE id = ?", [req.params.id], () => {
    res.json({ message: "Berhasil" });
  });
});


// LAYANAN
app.get('/api/layanan', (req, res) => {
  db.query("SELECT * FROM layanan ORDER BY id DESC", (err, results) => {
    res.json(results);
  });
});

app.get('/api/layanan/:id', (req, res) => {
  db.query("SELECT * FROM layanan WHERE id = ?", [req.params.id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ message: "Not found" });
    res.json(results[0]);
  });
});
app.post('/api/layanan', upload.single('image'), (req, res) => {
  const { title, description } = req.body;
  const image = req.file ? req.file.filename : null;
  db.query("INSERT INTO layanan (title, description, image) VALUES (?, ?, ?)", [title, description, image], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Berhasil" });
  });
});
app.put('/api/layanan/:id', upload.single('image'), (req, res) => {
  const { title, description } = req.body;
  if (req.file) {
    db.query("UPDATE layanan SET title=?, description=?, image=? WHERE id=?", [title, description, req.file.filename, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Berhasil" });
    });
  } else {
    db.query("UPDATE layanan SET title=?, description=? WHERE id=?", [title, description, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Berhasil" });
    });
  }
});
app.delete('/api/layanan/:id', (req, res) => {
  db.query("DELETE FROM layanan WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Berhasil" });
  });
});

// APPOINTMENTS
app.get('/api/appointments', (req, res) => {
  db.query("SELECT * FROM appointments ORDER BY id DESC", (err, results) => {
    res.json(results);
  });
});
app.post('/api/appointments', (req, res) => {
  const { name, number, email, address, message } = req.body;
  db.query("INSERT INTO appointments (name, number, email, address, message) VALUES (?, ?, ?, ?, ?)", [name, number, email, address, message], () => {
    res.json({ message: "Berhasil" });
  });
});
app.put('/api/appointments/:id/status', (req, res) => {
  db.query("UPDATE appointments SET status = ? WHERE id = ?", [req.body.status, req.params.id], () => {
    res.json({ message: "Berhasil" });
  });
});
app.delete('/api/appointments/:id', (req, res) => {
  db.query("DELETE FROM appointments WHERE id = ?", [req.params.id], () => {
    res.json({ message: "Berhasil" });
  });
});

// TANAMAN
app.get('/api/tanaman', (req, res) => {
  db.query("SELECT * FROM tanaman ORDER BY id DESC", (err, results) => {
    res.json(results);
  });
});
app.get('/api/tanaman/:id', (req, res) => {
  db.query("SELECT * FROM tanaman WHERE id = ?", [req.params.id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ message: "Not found" });
    res.json(results[0]);
  });
});
app.post('/api/tanaman', upload.single('gambar'), (req, res) => {
  const { nama, jenis, lokasi, deskripsi } = req.body;
  const gambar = req.file ? req.file.filename : null;
  db.query("INSERT INTO tanaman (nama, jenis, lokasi, deskripsi, gambar) VALUES (?, ?, ?, ?, ?)", [nama, jenis, lokasi, deskripsi, gambar], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Berhasil", id: results.insertId });
  });
});
app.put('/api/tanaman/:id', upload.single('gambar'), (req, res) => {
  const { nama, jenis, lokasi, deskripsi } = req.body;
  if (req.file) {
    db.query("UPDATE tanaman SET nama=?, jenis=?, lokasi=?, deskripsi=?, gambar=? WHERE id=?", [nama, jenis, lokasi, deskripsi, req.file.filename, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Berhasil" });
    });
  } else {
    db.query("UPDATE tanaman SET nama=?, jenis=?, lokasi=?, deskripsi=? WHERE id=?", [nama, jenis, lokasi, deskripsi, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Berhasil" });
    });
  }
});
app.delete('/api/tanaman/:id', (req, res) => {
  db.query("DELETE FROM tanaman WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Berhasil" });
  });
});

// API untuk aksi perawatan tanaman (siram, pupuk, panen)
app.post('/api/tanaman/:id/aksi', (req, res) => {
  const { tipe_aksi, nama_perawat, role_perawat, user_id } = req.body;
  const tanaman_id = req.params.id;
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ message: "Akses ditolak. Belum login." });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Token tidak valid atau sudah kadaluarsa." });
    
    // Check if it's santri token or internal user token
    // Santri tokens have user.id from pendaftar_santri table
    // Internal user tokens have user.id from admin_users table
    
    // For santri, validate status
    db.query("SELECT id, nama, username, status_pendaftaran FROM pendaftar_santri WHERE id = ?", [user.id], (err, santriResults) => {
      if (err) return res.status(500).json({ message: "Terjadi kesalahan database." });
      
      if (santriResults.length > 0) {
        // This is a santri
        const santri = santriResults[0];
        
        if (santri.status_pendaftaran !== 'Diterima') {
          return res.status(403).json({ 
            message: "Maaf, Anda belum diterima sebagai santri. Silakan tunggu konfirmasi dari admin.",
            status: santri.status_pendaftaran
          });
        }
        
        // Insert with santri_id — nama_perawat diambil dari body request atau DB
        const finalNamaPerawat = nama_perawat || santri.nama;
        const finalRolePerawat = role_perawat || 'Santri';
        
        const query = `
          INSERT INTO log_perawatan (tanaman_id, santri_id, jenis_tindakan, nama_perawat, role_perawat, waktu_tindakan)
          VALUES (?, ?, ?, ?, ?, NOW())
        `;
        
        db.query(query, [tanaman_id, santri.id, tipe_aksi, finalNamaPerawat, finalRolePerawat], (err, results) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Tindakan berhasil dicatat", id: results.insertId });
        });
      } else {
        // This might be an internal user (admin/petugas), check admin_users table
        db.query("SELECT id, username, nama_lengkap, role FROM admin_users WHERE id = ?", [user.id], (err, adminResults) => {
          if (err) return res.status(500).json({ message: "Terjadi kesalahan database." });
          
          if (adminResults.length > 0) {
            // This is an internal user
            const admin = adminResults[0];
            
            // Insert without santri_id (NULL)
            const finalNamaPerawat = nama_perawat || admin.nama_lengkap || admin.username || 'Petugas';
            const finalRolePerawat = role_perawat || admin.role || 'Petugas';
            
            const query = `
              INSERT INTO log_perawatan (tanaman_id, santri_id, jenis_tindakan, nama_perawat, role_perawat, waktu_tindakan)
              VALUES (?, NULL, ?, ?, ?, NOW())
            `;
            
            db.query(query, [tanaman_id, tipe_aksi, finalNamaPerawat, finalRolePerawat], (err, results) => {
              if (err) return res.status(500).json({ error: err.message });
              res.json({ message: "Tindakan berhasil dicatat", id: results.insertId });
            });
          } else {
            return res.status(404).json({ message: "User tidak ditemukan." });
          }
        });
      }
    });
  });
});

// API untuk riwayat perawatan tanaman (public access)
app.get('/api/tanaman/:id/riwayat', (req, res) => {
  const tanaman_id = req.params.id;
  const query = `
    SELECT l.id, l.tanaman_id, l.jenis_tindakan, l.waktu_tindakan, l.nama_perawat, l.role_perawat,
           t.nama AS nama_tanaman, s.nama AS nama_santri
    FROM log_perawatan l
    JOIN tanaman t ON l.tanaman_id = t.id
    LEFT JOIN pendaftar_santri s ON l.santri_id = s.id
    WHERE l.tanaman_id = ?
    ORDER BY l.waktu_tindakan DESC
  `;
  
  db.query(query, [tanaman_id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// LOG PERAWATAN
app.get('/api/log_perawatan', (req, res) => {
  const query = `
    SELECT l.id, l.tanaman_id, l.jenis_tindakan, l.waktu_tindakan, l.nama_perawat, l.role_perawat, t.nama AS nama_tanaman, s.nama AS nama_santri 
    FROM log_perawatan l 
    JOIN tanaman t ON l.tanaman_id = t.id 
    LEFT JOIN pendaftar_santri s ON l.santri_id = s.id 
    ORDER BY l.waktu_tindakan DESC
  `;
  db.query(query, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});
app.post('/api/log_perawatan', authenticateSantriToken, (req, res) => {
  const { tanaman_id, jenis_tindakan } = req.body;
  const santri_id = req.user.id;
  db.query("INSERT INTO log_perawatan (tanaman_id, santri_id, jenis_tindakan) VALUES (?, ?, ?)", [tanaman_id, santri_id, jenis_tindakan], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Perawatan berhasil dicatat" });
  });
});

// FOTO PERKEMBANGAN
app.get('/api/foto_perkembangan/:tanaman_id', (req, res) => {
  const query = `
    SELECT f.id, f.tanaman_id, f.gambar, f.waktu_upload, s.nama AS nama_pengunggah
    FROM foto_perkembangan f
    JOIN pendaftar_santri s ON f.santri_id = s.id
    WHERE f.tanaman_id = ?
    ORDER BY f.waktu_upload DESC
  `;
  db.query(query, [req.params.tanaman_id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.post('/api/foto_perkembangan', authenticateSantriToken, upload.single('gambar'), (req, res) => {
  const { tanaman_id } = req.body;
  const santri_id = req.user.id;
  const gambar = req.file ? req.file.filename : null;
  
  if (!gambar) return res.status(400).json({ error: "Gambar wajib diunggah" });

  db.query("INSERT INTO foto_perkembangan (tanaman_id, santri_id, gambar) VALUES (?, ?, ?)", [tanaman_id, santri_id, gambar], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Foto perkembangan berhasil diunggah", id: results.insertId });
  });
});

// ADMIN LOGIN
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.query("SELECT * FROM admin_users WHERE username = ?", [username], async (err, results) => {
    if (results.length === 0) return res.status(401).json({ error: "Username tidak ditemukan!" });
    const isMatch = await bcrypt.compare(password, results[0].password);
    if (!isMatch) return res.status(401).json({ error: "Password salah!" });
    res.json({ message: "Login berhasil", token: jwt.sign({ id: results[0].id, username: results[0].username }, JWT_SECRET, { expiresIn: '1d' }) });
  });
});
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Gagal" });
  res.json({ url: `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}` });
});

// ============================================================
// SISTEM JADWAL AKTIVITAS PONDOK
// ============================================================

// Pastikan tabel ada saat server start (idempotent)
db.connect === undefined || (() => {})(); // guard – tabel dibuat di blok connect atas

// Helper: hitung tanggal jatuh tempo berikutnya dari sebuah jadwal
function hitungTanggalJatuhTempo(tanggalMulai, intervalHari, polaPengulangan) {
  const mulai = new Date(tanggalMulai);
  mulai.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (polaPengulangan === 'sekali') return [mulai];

  const tanggalList = [];
  let cur = new Date(mulai);
  // Kumpulkan semua tanggal dari tanggal_mulai sampai hari ini + 1 interval ke depan
  while (cur <= new Date(today.getTime() + intervalHari * 24 * 60 * 60 * 1000)) {
    tanggalList.push(new Date(cur));
    cur = new Date(cur.getTime() + intervalHari * 24 * 60 * 60 * 1000);
  }
  return tanggalList;
}

// Format date ke YYYY-MM-DD (timezone safe)
function toDateStr(d) {
  const dd = new Date(d);
  const y  = dd.getFullYear();
  const m  = String(dd.getMonth() + 1).padStart(2, '0');
  const day= String(dd.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Buat tabel jadwal saat koneksi pertama (tambahan ke blok tables yang ada)
const jadwalTables = [
  `CREATE TABLE IF NOT EXISTS activity_schedules (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    nama_aktivitas   VARCHAR(255) NOT NULL,
    kategori         VARCHAR(100) NOT NULL,
    deskripsi        TEXT,
    pola_perulangan  ENUM('sekali','harian','mingguan','bulanan') NOT NULL DEFAULT 'mingguan',
    interval_hari    INT NOT NULL DEFAULT 7,
    tanggal_mulai    DATE NOT NULL,
    tanggal_selesai  DATE NULL,
    penanggung_jawab INT NULL,
    status           ENUM('aktif','nonaktif','selesai') NOT NULL DEFAULT 'aktif',
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (penanggung_jawab) REFERENCES pendaftar_santri(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS activity_tasks (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    schedule_id     INT NOT NULL,
    santri_id       INT NULL,
    nama_santri     VARCHAR(255) NULL,
    tanggal_tugas   DATE NOT NULL,
    status          ENUM('pending','selesai','dilewati') NOT NULL DEFAULT 'pending',
    catatan         TEXT NULL,
    foto_bukti      VARCHAR(255) NULL,
    diselesaikan_at TIMESTAMP NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (schedule_id) REFERENCES activity_schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (santri_id)   REFERENCES pendaftar_santri(id)   ON DELETE SET NULL,
    UNIQUE KEY uq_schedule_tanggal (schedule_id, tanggal_tugas)
  )`
];
// Buat tabel secara sequential agar FK tidak gagal
(function createJadwalTablesSeq(idx) {
  if (idx >= jadwalTables.length) return;
  db.query(jadwalTables[idx], (err) => {
    if (err && err.code !== 'ER_TABLE_EXISTS_ERROR') {
      console.error(`[Jadwal Table ${idx+1}] Error:`, err.message);
    } else {
      console.log(`[Jadwal Table ${idx+1}] Siap ✅`);
    }
    createJadwalTablesSeq(idx + 1);
  });
})(0);

// ── CRON: generate tiket activity_tasks setiap hari jam 00:01 ────────────────
function generateTiketHarian() {
  const todayStr = toDateStr(new Date());
  console.log(`[CRON] Generate tiket untuk tanggal: ${todayStr}`);

  const qAktif = `
    SELECT s.*
    FROM activity_schedules s
    WHERE s.status = 'aktif'
      AND s.tanggal_mulai <= ?
      AND (s.tanggal_selesai IS NULL OR s.tanggal_selesai >= ?)
  `;
  db.query(qAktif, [todayStr, todayStr], (err, schedules) => {
    if (err) { console.error('[CRON] Query jadwal aktif gagal:', err.message); return; }

    schedules.forEach((sch) => {
      // Parse penanggung_jawab CSV to array
      const penanggungJawabIds = sch.penanggung_jawab ? sch.penanggung_jawab.split(',').map(id => id.trim()) : [];
      
      if (penanggungJawabIds.length === 0) {
        console.log(`[CRON] Schedule ${sch.id} tidak memiliki penanggung jawab, skip`);
        return;
      }

      // Cek apakah hari ini adalah hari jatuh tempo berdasarkan interval
      const mulai = new Date(sch.tanggal_mulai);
      mulai.setHours(0, 0, 0, 0);
      const today = new Date(todayStr);
      today.setHours(0, 0, 0, 0);
      const selisihHari = Math.round((today - mulai) / (1000 * 60 * 60 * 24));

      let jatuhTempo = false;
      if (sch.pola_perulangan === 'sekali') {
        jatuhTempo = selisihHari === 0;
      } else {
        jatuhTempo = selisihHari >= 0 && selisihHari % sch.interval_hari === 0;
      }

      if (!jatuhTempo) return;

      // Generate tiket untuk setiap penanggung jawab
      penanggungJawabIds.forEach((santriId) => {
        // Fetch nama santri
        db.query('SELECT nama FROM pendaftar_santri WHERE id=?', [santriId], (err, rows) => {
          if (err) {
            console.error(`[CRON] Gagal fetch nama santri ${santriId}:`, err.message);
            return;
          }
          const namaSantri = rows && rows.length ? rows[0].nama : null;
          if (!namaSantri) return;

          // Insert tiket — IGNORE jika sudah ada (UNIQUE KEY)
          const qInsert = `
            INSERT IGNORE INTO activity_tasks
              (schedule_id, santri_id, nama_santri, tanggal_tugas, status)
            VALUES (?, ?, ?, ?, 'pending')
          `;
          db.query(qInsert, [sch.id, santriId, namaSantri, todayStr], (err) => {
            if (err) console.error(`[CRON] Gagal buat tiket schedule ${sch.id} santri ${santriId}:`, err.message);
            else console.log(`[CRON] ✅ Tiket dibuat: schedule=${sch.id} | santri=${namaSantri} | ${todayStr}`);
          });
        });
      });

      // Jika sekali jalan, tandai master jadi selesai
      if (sch.pola_perulangan === 'sekali') {
        db.query("UPDATE activity_schedules SET status='selesai' WHERE id=?", [sch.id]);
      }
    });
  });
}

// Jadwalkan cron setiap jam 00:01 — tanpa library eksternal
function scheduleCron() {
  const now    = new Date();
  const target = new Date(now);
  target.setHours(0, 1, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1); // besok jika sudah lewat
  const msUntil = target - now;

  setTimeout(() => {
    generateTiketHarian();
    setInterval(generateTiketHarian, 24 * 60 * 60 * 1000); // setiap 24 jam
  }, msUntil);

  console.log(`[CRON] Dijadwalkan jam 00:01 (dalam ${Math.round(msUntil / 60000)} menit)`);
}
scheduleCron();
// Juga jalankan sekali saat server start supaya tiket hari ini langsung ada
setTimeout(generateTiketHarian, 3000);

// ── ACTIVITY SCHEDULES (MASTER) ──────────────────────────────────────────────

// GET daftar santri yang sudah terdaftar (punya akun) — untuk dropdown admin
app.get('/api/santri-terdaftar', (req, res) => {
  // Ambil semua santri yang sudah punya akun di pendaftar_santri
  const q = `SELECT id, nama, username, status_pendaftaran FROM pendaftar_santri ORDER BY nama ASC`;
  db.query(q, (err, results) => {
    if (err) {
      console.error('[/api/santri-terdaftar] Error:', err.message);
      return res.status(500).json({ error: err.message });
    }
    console.log(`[/api/santri-terdaftar] Returning ${results.length} santri`);
    res.json(results || []);
  });
});

// GET rekap kinerja santri (HARUS sebelum /api/tugas/:id agar tidak conflict)
app.get('/api/rekap-tugas', (req, res) => {
  const q = `
    SELECT
      t.santri_id,
      t.nama_santri,
      COUNT(*)                                              AS total_tugas,
      SUM(t.status = 'selesai')                            AS selesai,
      SUM(t.status = 'pending')                            AS pending,
      SUM(t.status = 'dilewati')                           AS dilewati,
      ROUND(SUM(t.status = 'selesai') / COUNT(*) * 100, 1) AS persen_selesai
    FROM activity_tasks t
    GROUP BY t.santri_id, t.nama_santri
    ORDER BY selesai DESC
  `;
  db.query(q, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// GET semua jadwal + nama penanggung jawab
app.get('/api/jadwal', (req, res) => {
  const q = `
    SELECT s.*, p.nama AS nama_pj, p.username AS username_pj
    FROM activity_schedules s
    LEFT JOIN pendaftar_santri p ON s.penanggung_jawab = p.id
    ORDER BY s.id DESC
  `;
  db.query(q, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// GET detail satu jadwal
app.get('/api/jadwal/:id', (req, res) => {
  const q = `
    SELECT s.*, p.nama AS nama_pj
    FROM activity_schedules s
    LEFT JOIN pendaftar_santri p ON s.penanggung_jawab = p.id
    WHERE s.id = ?
  `;
  db.query(q, [req.params.id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ message: 'Tidak ditemukan' });
    res.json(results[0]);
  });
});

// Helper: generate semua tiket untuk satu jadwal dari tanggal_mulai s/d hari ini
function generateTiketUntukJadwal(sch, namaSantri, callback) {
  const todayStr = toDateStr(new Date());
  const mulai    = new Date(sch.tanggal_mulai);
  mulai.setHours(0, 0, 0, 0);
  const today = new Date(todayStr);
  today.setHours(0, 0, 0, 0);

  const tanggalList = [];
  if (sch.pola_perulangan === 'sekali') {
    // Hanya tanggal_mulai
    tanggalList.push(toDateStr(mulai));
  } else {
    let cur = new Date(mulai);
    while (cur <= today) {
      tanggalList.push(toDateStr(cur));
      cur = new Date(cur.getTime() + sch.interval_hari * 24 * 60 * 60 * 1000);
    }
  }

  if (tanggalList.length === 0) return callback && callback();

  let done = 0;
  tanggalList.forEach((tgl) => {
    db.query(
      `INSERT IGNORE INTO activity_tasks (schedule_id, santri_id, nama_santri, tanggal_tugas, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [sch.id, sch.penanggung_jawab, namaSantri, tgl],
      () => { done++; if (done === tanggalList.length && callback) callback(); }
    );
  });
}

// POST buat jadwal baru — langsung generate tiket ke santri (multi-santri support)
app.post('/api/jadwal', (req, res) => {
  const { nama_aktivitas, kategori, sub_tugas, deskripsi, pola_perulangan, interval_hari, tanggal_mulai, waktu_mulai, tanggal_selesai, penanggung_jawab } = req.body;
  
  console.log('[POST /api/jadwal] Menerima:', { nama_aktivitas, kategori, pola_perulangan, tanggal_mulai, penanggung_jawab });
  
  // Handle array or single penanggung_jawab
  const penanggungJawabArray = Array.isArray(penanggung_jawab) ? penanggung_jawab : (penanggung_jawab ? [penanggung_jawab] : []);
  const penanggungJawabString = penanggungJawabArray.length > 0 ? penanggungJawabArray.join(',') : null;

  const interval = pola_perulangan === 'sekali' ? 1 : parseInt(interval_hari) || 7;

  db.query(
    `INSERT INTO activity_schedules (nama_aktivitas, kategori, sub_tugas, deskripsi, pola_perulangan, interval_hari, tanggal_mulai, waktu_mulai, tanggal_selesai, penanggung_jawab)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nama_aktivitas, kategori, sub_tugas || null, deskripsi || null, pola_perulangan, interval,
     tanggal_mulai, waktu_mulai || '08:00', tanggal_selesai || null, penanggungJawabString],
    (err, result) => {
      if (err) {
        console.error('[POST /api/jadwal] DB Error:', err.message);
        return res.status(500).json({ error: err.message });
      }
      const scheduleId = result.insertId;
      console.log(`[POST /api/jadwal] Jadwal tersimpan dengan ID: ${scheduleId}`);

      // Generate tiket untuk semua santri yang ditunjuk
      if (penanggungJawabArray.length > 0) {
        let completed = 0;
        const total = penanggungJawabArray.length;

        penanggungJawabArray.forEach((santriId) => {
          db.query('SELECT nama FROM pendaftar_santri WHERE id=?', [santriId], (err, rows) => {
            const namaSantri = rows && rows.length ? rows[0].nama : null;
            console.log(`[POST /api/jadwal] Generate tiket untuk santri: ${namaSantri} (id=${santriId})`);
            const sch = { id: scheduleId, pola_perulangan, interval_hari: interval, tanggal_mulai, penanggung_jawab: santriId };
            generateTiketUntukJadwal(sch, namaSantri, () => {
              completed++;
              if (completed === total) {
                // Jika sekali, tandai selesai
                if (pola_perulangan === 'sekali') {
                  db.query("UPDATE activity_schedules SET status='selesai' WHERE id=?", [scheduleId]);
                }
                res.json({ message: `Jadwal berhasil dibuat dan tiket sudah dikirim ke ${total} santri`, id: scheduleId });
              }
            });
          });
        });
      } else {
        res.json({ message: 'Jadwal berhasil dibuat', id: scheduleId });
      }
    }
  );
});

// PUT update jadwal — jika PJ berubah, regenerate tiket pending mendatang ke PJ baru (multi-santri support)
app.put('/api/jadwal/:id', (req, res) => {
  const { nama_aktivitas, kategori, sub_tugas, deskripsi, pola_perulangan, interval_hari, tanggal_mulai, waktu_mulai, tanggal_selesai, penanggung_jawab, status } = req.body;
  
  // Handle array or single penanggung_jawab
  const penanggungJawabArray = Array.isArray(penanggung_jawab) ? penanggung_jawab : (penanggung_jawab ? [penanggung_jawab] : []);
  const penanggungJawabString = penanggungJawabArray.length > 0 ? penanggungJawabArray.join(',') : null;

  const interval = pola_perulangan === 'sekali' ? 1 : parseInt(interval_hari) || 7;

  // Ambil data lama untuk cek apakah PJ berubah
  db.query('SELECT penanggung_jawab FROM activity_schedules WHERE id=?', [req.params.id], (err, oldRows) => {
    if (err) return res.status(500).json({ error: err.message });
    const oldPJ = oldRows.length ? oldRows[0].penanggung_jawab : null;

    db.query(
      `UPDATE activity_schedules SET
         nama_aktivitas=?, kategori=?, sub_tugas=?, deskripsi=?, pola_perulangan=?,
         interval_hari=?, tanggal_mulai=?, waktu_mulai=?, tanggal_selesai=?,
         penanggung_jawab=?, status=?
       WHERE id=?`,
      [nama_aktivitas, kategori, sub_tugas || null, deskripsi || null, pola_perulangan, interval,
       tanggal_mulai, waktu_mulai || '08:00', tanggal_selesai || null, penanggungJawabString, status || 'aktif',
       req.params.id],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Jadwal berhasil diperbarui' });
      }
    );
  });
});

// DELETE jadwal (cascade ke activity_tasks)
app.delete('/api/jadwal/:id', (req, res) => {
  db.query('DELETE FROM activity_schedules WHERE id=?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Jadwal dihapus' });
  });
});

// PATCH status jadwal (aktif / nonaktif / selesai)
app.patch('/api/jadwal/:id/status', (req, res) => {
  const { status } = req.body;
  db.query('UPDATE activity_schedules SET status=? WHERE id=?', [status, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: `Status diubah ke ${status}` });
  });
});

// ── ACTIVITY TASKS (TRANSAKSI) ────────────────────────────────────────────────

// GET semua tiket tugas (admin view)
app.get('/api/tugas', (req, res) => {
  const q = `
    SELECT t.*, s.nama_aktivitas, s.kategori, s.pola_perulangan
    FROM activity_tasks t
    JOIN activity_schedules s ON t.schedule_id = s.id
    ORDER BY t.tanggal_tugas DESC
  `;
  db.query(q, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// GET tiket HARI INI milik santri yang login
// ⚠️ Harus SEBELUM /api/tugas/:id agar tidak dianggap param
app.get('/api/tugas/hari-ini', authenticateSantriToken, (req, res) => {
  const santriId = req.user.id;
  const todayStr = toDateStr(new Date());
  const q = `
    SELECT t.*, s.nama_aktivitas, s.kategori, s.deskripsi
    FROM activity_tasks t
    JOIN activity_schedules s ON t.schedule_id = s.id
    WHERE t.santri_id = ? AND t.tanggal_tugas = ?
    ORDER BY t.id ASC
  `;
  db.query(q, [santriId, todayStr], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// GET semua tugas milik santri yang login (riwayat lengkap)
app.get('/api/tugas/saya', authenticateSantriToken, (req, res) => {
  const santriId = req.user.id;
  const q = `
    SELECT t.*, s.nama_aktivitas, s.kategori, s.deskripsi, s.pola_perulangan
    FROM activity_tasks t
    JOIN activity_schedules s ON t.schedule_id = s.id
    WHERE t.santri_id = ?
    ORDER BY t.tanggal_tugas DESC
  `;
  db.query(q, [santriId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// GET tugas mendatang milik santri yang login (belum lewat, status pending)
app.get('/api/tugas/mendatang', authenticateSantriToken, (req, res) => {
  const santriId = req.user.id;
  const todayStr = toDateStr(new Date());
  const q = `
    SELECT t.*, s.nama_aktivitas, s.kategori, s.deskripsi
    FROM activity_tasks t
    JOIN activity_schedules s ON t.schedule_id = s.id
    WHERE t.santri_id = ? AND t.tanggal_tugas > ? AND t.status = 'pending'
    ORDER BY t.tanggal_tugas ASC
    LIMIT 10
  `;
  db.query(q, [santriId, todayStr], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// GET status santri lain dalam tugas yang sama (monitoring feature)
app.get('/api/tugas/:id/rekan', authenticateSantriToken, (req, res) => {
  const santriId = req.user.id;
  const taskId = req.params.id;
  
  // First get the schedule_id for this task
  db.query('SELECT schedule_id, tanggal_tugas FROM activity_tasks WHERE id=?', [taskId], (err, taskRows) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!taskRows.length) return res.status(404).json({ message: 'Tugas tidak ditemukan' });
    
    const scheduleId = taskRows[0].schedule_id;
    const tanggalTugas = taskRows[0].tanggal_tugas;
    
    // Get all tasks for the same schedule and date (excluding current santri)
    const q = `
      SELECT t.id, t.santri_id, t.nama_santri, t.status, t.diselesaikan_at, t.catatan, t.foto_bukti
      FROM activity_tasks t
      WHERE t.schedule_id = ? AND t.tanggal_tugas = ? AND t.santri_id != ?
      ORDER BY t.status ASC, t.nama_santri ASC
    `;
    
    db.query(q, [scheduleId, tanggalTugas, santriId], (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    });
  });
});

// POST tiket manual (admin bisa buat tiket ad-hoc)
app.post('/api/tugas', (req, res) => {
  const { schedule_id, santri_id, nama_santri, tanggal_tugas } = req.body;
  db.query(
    `INSERT IGNORE INTO activity_tasks (schedule_id, santri_id, nama_santri, tanggal_tugas)
     VALUES (?, ?, ?, ?)`,
    [schedule_id, santri_id || null, nama_santri || null, tanggal_tugas],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Tiket tugas dibuat', id: result.insertId });
    }
  );
});

// PATCH tandai selesai — santri upload foto opsional
app.patch('/api/tugas/:id/selesai', authenticateSantriToken, upload.single('foto_bukti'), (req, res) => {
  const santriId  = req.user.id;
  const { catatan } = req.body;
  const fotoBukti = req.file ? req.file.filename : null;

  db.query('SELECT * FROM activity_tasks WHERE id=?', [req.params.id], (err, rows) => {
    if (err)            return res.status(500).json({ error: err.message });
    if (!rows.length)   return res.status(404).json({ message: 'Tiket tidak ditemukan' });
    if (rows[0].santri_id !== santriId)
                        return res.status(403).json({ message: 'Bukan tugas Anda' });
    if (rows[0].status === 'selesai')
                        return res.status(400).json({ message: 'Tugas sudah ditandai selesai' });

    db.query(
      `UPDATE activity_tasks SET status='selesai', catatan=?, foto_bukti=?, diselesaikan_at=NOW() WHERE id=?`,
      [catatan || null, fotoBukti, req.params.id],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Tugas berhasil ditandai selesai' });
      }
    );
  });
});

// PATCH status tiket oleh admin
app.patch('/api/tugas/:id/status', (req, res) => {
  const { status } = req.body;
  db.query('UPDATE activity_tasks SET status=? WHERE id=?', [status, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: `Status tiket diubah ke ${status}` });
  });
});

// DELETE tiket tugas (admin)
app.delete('/api/tugas/:id', (req, res) => {
  db.query('DELETE FROM activity_tasks WHERE id=?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Tiket dihapus' });
  });
});

// ── TRIGGER MANUAL CRON ───────────────────────────────────────────────────────
app.post('/api/jadwal/generate-tiket', (req, res) => {
  generateTiketHarian();
  res.json({ message: 'Generate tiket dijalankan untuk hari ini' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server Backend berjalan di http://localhost:${PORT}`));
