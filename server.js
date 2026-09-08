const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const sharp = require('sharp');

// Setup Multer & Sharp untuk Optimasi Gambar Otomatis (ke KB)
const multerStorage = multer.memoryStorage();
const multerUpload = multer({ storage: multerStorage });

const upload = {
  single: function(fieldName) {
    return async function(req, res, next) {
      multerUpload.single(fieldName)(req, res, async function(err) {
        if (err) return next(err);
        if (!req.file) return next();
        
        try {
          const dir = './uploads';
          if (!fs.existsSync(dir)) fs.mkdirSync(dir);
          
          const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + '.webp';
          const filepath = path.join(dir, filename);
          
          // Kompresi ekstrim menggunakan Sharp ke format WebP
          await sharp(req.file.buffer)
            .resize({ width: 1080, withoutEnlargement: true }) // Maksimal lebar 1080px
            .webp({ quality: 75 }) // Kualitas 75% untuk menekan ukuran hingga puluhan/ratusan KB saja
            .toFile(filepath);
            
          // Update req.file agar route selanjutnya membaca file yang sudah disimpan
          req.file.filename = filename;
          req.file.path = filepath;
          req.file.mimetype = 'image/webp';
          
          next();
        } catch (error) {
          console.error("Gagal mengkompresi gambar:", error);
          next(error);
        }
      });
    };
  }
};

const JWT_SECRET = process.env.JWT_SECRET || 'alfilaha_super_secret_key_2026';

const app = express();

const allowedOrigins = ['http://localhost:5173', 'https://alfilaha.id', 'http://192.168.1.32:5173']; // Tambahkan domain frontend Anda di sini

// Middleware
app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept']
}));

app.use(express.json());
app.use('/uploads', express.static('uploads')); // Serve uploaded images

// Konfigurasi Koneksi Database
const db = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'db_alfilaha'
});

// Cek Koneksi ke MySQL
db.connect((err) => {
  if (err) {
    console.error('❌ Gagal koneksi ke database:', err);
    return;
  }
  console.log('✅ Berhasil terhubung ke MySQL (db_alfilaha)');
  
  // Auto-create tabel reservasi jika belum ada
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS reservasi (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nama VARCHAR(100) NOT NULL,
      whatsapp VARCHAR(20) NOT NULL,
      email VARCHAR(100),
      instansi VARCHAR(100),
      tanggal VARCHAR(50) NOT NULL,
      jumlah VARCHAR(100) NOT NULL,
      pesan TEXT,
      status VARCHAR(20) DEFAULT 'Pending'
    )
  `;
  db.query(createTableQuery, (err) => {
    if (err) console.error("❌ Gagal mengecek/membuat tabel reservasi:", err);
    else console.log("✅ Tabel 'reservasi' siap digunakan.");
  });

  // Auto-create tabel paket_wisata
  const createPaketQuery = `
    CREATE TABLE IF NOT EXISTS paket_wisata (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nama_paket VARCHAR(100) NOT NULL,
      harga VARCHAR(50) NOT NULL,
      deskripsi TEXT
    )
  `;
  db.query(createPaketQuery, (err) => {
    if (err) console.error("❌ Gagal membuat tabel paket_wisata:", err);
    else {
      console.log("✅ Tabel 'paket_wisata' siap digunakan.");
      // Seed data awal jika tabel masih kosong
      db.query("SELECT COUNT(*) AS count FROM paket_wisata", (err, results) => {
        if (!err && results[0].count === 0) {
          const seedQuery = "INSERT INTO paket_wisata (nama_paket, harga, deskripsi) VALUES ?";
          const seedValues = [
            ['Edukasi Basic', 'Rp 50.000 / orang', 'Fasilitas: Keliling kebun, panen sayur 1 macam, air mineral.'],
            ['Edukasi Premium', 'Rp 100.000 / orang', 'Fasilitas: Keliling kebun, panen sayur 3 macam, snack, sertifikat.'],
            ['Paket Wisata Keluarga', 'Rp 150.000 / keluarga', 'Fasilitas: Gazebo private, alat BBQ, panen buah sepuasnya.']
          ];
          db.query(seedQuery, [seedValues], (err) => {
            if(!err) console.log("✅ Data awal paket wisata berhasil dimasukkan.");
          });
        }
      });
    }
  });

  // Auto-create tabel events
  const createEventsQuery = `
    CREATE TABLE IF NOT EXISTS events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      category VARCHAR(100) NOT NULL,
      date VARCHAR(100) NOT NULL,
      description TEXT,
      image VARCHAR(255)
    )
  `;
  db.query(createEventsQuery, (err) => {
    if (err) console.error("❌ Gagal membuat tabel events:", err);
    else {
      console.log("✅ Tabel 'events' siap digunakan.");
      
      db.query("SELECT COUNT(*) AS count FROM events", (err, results) => {
        if (!err && results[0].count === 0) {
          const seedQuery = "INSERT INTO events (title, category, date, description, image) VALUES ?";
          const seedValues = [
            ['Pelatihan Pertanian Organik', 'Kegiatan', '15 Agu 2026', 'Workshop intensif tentang teknik pertanian organik dan sustainable farming untuk santri dan masyarakat umum.', null],
            ['Family Day: Berkebun Bersama', 'Event', '22 Agu 2026', 'Ajak keluarga untuk belajar berkebun dan menanam bersama di kebun Alfilaha. Aktivitas seru dan edukatif!', null],
            ['Komposting dan Pengelolaan Sampah', 'Workshop', '29 Agu 2026', 'Belajar cara mengolah sampah organik menjadi kompos berkualitas untuk kesuburan tanah.', null]
          ];
          db.query(seedQuery, [seedValues], (err) => {
            if(!err) console.log("✅ Data awal events berhasil dimasukkan.");
          });
        }
      });
    }
  });

  // Auto-create tabel blogs
  const createBlogsQuery = `
    CREATE TABLE IF NOT EXISTS blogs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      date VARCHAR(100) NOT NULL,
      excerpt TEXT,
      content LONGTEXT,
      image VARCHAR(255)
    )
  `;
  db.query(createBlogsQuery, (err) => {
    if (err) console.error("❌ Gagal membuat tabel blogs:", err);
    else {
      console.log("✅ Tabel 'blogs' siap digunakan.");
      
      db.query("SELECT COUNT(*) AS count FROM blogs", (err, results) => {
        if (!err && results[0].count === 0) {
          const seedQuery = "INSERT INTO blogs (title, date, excerpt, content, image) VALUES ?";
          const seedValues = [
            ['Menjaga Kualitas Beras Organik', '12 Okt 2023', 'Beras organik bebas dari pestisida buatan dan pupuk sintetis, sehingga lebih aman bagi...', '<p>Beras organik bebas dari pestisida buatan dan pupuk sintetis, sehingga lebih aman bagi kesehatan tubuh kita.</p>', null],
            ['Promo Spesial Ramadhan 1445H', '15 Okt 2023', 'Menyambut bulan suci Ramadhan, Alfilaha memberikan promo khusus untuk semua jenis...', '<p>Menyambut bulan suci Ramadhan, Alfilaha memberikan promo khusus untuk semua jenis produk beras.</p>', null]
          ];
          db.query(seedQuery, [seedValues], (err) => {
            if(!err) console.log("✅ Data awal blogs berhasil dimasukkan.");
          });
        }
      });
    }
  });

  // Auto-create tabel appointments
  const createAppointmentsQuery = `
    CREATE TABLE IF NOT EXISTS appointments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      number VARCHAR(20),
      email VARCHAR(100) NOT NULL,
      address TEXT,
      message TEXT,
      status VARCHAR(20) DEFAULT 'Pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  db.query(createAppointmentsQuery, (err) => {
    if (err) console.error("❌ Gagal membuat tabel appointments:", err);
    else console.log("✅ Tabel 'appointments' siap digunakan.");
  });


  // Auto-create tabel admin_users untuk Login
  const createAdminQuery = `
    CREATE TABLE IF NOT EXISTS admin_users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL
    )
  `;
  db.query(createAdminQuery, async (err) => {
    if (err) console.error("❌ Gagal membuat tabel admin_users:", err);
    else {
      console.log("✅ Tabel 'admin_users' siap digunakan.");
      // Seed default admin jika kosong (username: admin, password: admin123)
      db.query("SELECT COUNT(*) AS count FROM admin_users", async (err, results) => {
        if (!err && results[0].count === 0) {
          const hashedPassword = await bcrypt.hash("admin123", 10);
          db.query("INSERT INTO admin_users (username, password) VALUES (?, ?)", ['admin', hashedPassword], (err) => {
            if(!err) console.log("✅ Akun admin default berhasil dibuat (admin / admin123).");
          });
        }
      });
    }
  });

  // Auto-create tabel galeri
  const createGaleriQuery = `
    CREATE TABLE IF NOT EXISTS galeri (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      category VARCHAR(100) NOT NULL,
      image_url VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  db.query(createGaleriQuery, (err) => {
    if (err) console.error("❌ Gagal membuat tabel galeri:", err);
    else console.log("✅ Tabel 'galeri' siap digunakan.");
  });

  // Auto-create tabel layanan
  const createLayananQuery = `
    CREATE TABLE IF NOT EXISTS layanan (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      image VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  db.query(createLayananQuery, (err) => {
    if (err) console.error("❌ Gagal membuat tabel layanan:", err);
    else console.log("✅ Tabel 'layanan' siap digunakan.");
  });

  // ==========================================
  // TAMBAHAN BARU: Auto-create tabel pendaftar_santri
  // ==========================================
  const createPendaftarSantriQuery = `
    CREATE TABLE IF NOT EXISTS pendaftar_santri (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nama VARCHAR(255) NOT NULL,
      tempat_lahir VARCHAR(100) NOT NULL,
      tanggal_lahir DATE NOT NULL,
      jenis_kelamin ENUM('L', 'P') NOT NULL,
      alamat TEXT NOT NULL,
      no_wa VARCHAR(20) NOT NULL,
      email VARCHAR(255),
      username VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      status_pendaftaran ENUM('Menunggu Verifikasi', 'Diterima', 'Ditolak') DEFAULT 'Menunggu Verifikasi',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  db.query(createPendaftarSantriQuery, (err) => {
    if (err) console.error("❌ Gagal membuat tabel pendaftar_santri:", err);
    else console.log("✅ Tabel 'pendaftar_santri' siap digunakan.");
  });

  // ==========================================
  // TAMBAHAN BARU: Auto-create tabel program_pendaftaran
  // ==========================================
  const createProgramPendaftaranQuery = `
    CREATE TABLE IF NOT EXISTS program_pendaftaran (
      id INT AUTO_INCREMENT PRIMARY KEY,
      judul VARCHAR(255) NOT NULL,
      jenis VARCHAR(100) NOT NULL,
      nama VARCHAR(255) NOT NULL,
      status VARCHAR(50) DEFAULT 'aktif',
      batas_akhir DATE,
      poster VARCHAR(255),
      keterangan LONGTEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  db.query(createProgramPendaftaranQuery, (err) => {
    if (err) console.error("❌ Gagal membuat tabel program_pendaftaran:", err);
    else console.log("✅ Tabel 'program_pendaftaran' siap digunakan.");
  });

  const createTanamanQuery = `
    CREATE TABLE IF NOT EXISTS tanaman (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nama VARCHAR(255) NOT NULL,
      jenis VARCHAR(100),
      lokasi VARCHAR(255),
      deskripsi TEXT,
      kondisi VARCHAR(50) DEFAULT 'Sehat',
      gambar VARCHAR(255),
      usia VARCHAR(100),
      jadwal_siram VARCHAR(100),
      jadwal_pupuk VARCHAR(100),
      jadwal_panen VARCHAR(100),
      penanggung_jawab VARCHAR(255),
      kebutuhan_air VARCHAR(100),
      terakhir_dipupuk VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  db.query(createTanamanQuery, (err) => {
    if (err) console.error("❌ Gagal membuat tabel tanaman:", err);
    else {
      console.log("✅ Tabel 'tanaman' siap digunakan.");
      // Migrasi kolom baru jika belum ada
      const addCols = `
        ALTER TABLE tanaman 
        ADD COLUMN IF NOT EXISTS usia VARCHAR(100),
        ADD COLUMN IF NOT EXISTS jadwal_siram VARCHAR(100),
        ADD COLUMN IF NOT EXISTS jadwal_pupuk VARCHAR(100),
        ADD COLUMN IF NOT EXISTS jadwal_panen VARCHAR(100),
        ADD COLUMN IF NOT EXISTS penanggung_jawab VARCHAR(100),
        ADD COLUMN IF NOT EXISTS kebutuhan_air VARCHAR(100),
        ADD COLUMN IF NOT EXISTS terakhir_dipupuk VARCHAR(100);
      `;
      db.query(addCols, (e) => {
        if(e && e.code !== 'ER_DUP_FIELDNAME') console.log("Info kolom tanaman: ", e.message);
      });
      db.query("ALTER TABLE tanaman MODIFY COLUMN penanggung_jawab VARCHAR(255)", (e) => {
        if(e) console.log("Info update panjang penanggung_jawab: ", e.message);
      });
    }
  });

  const createLogPerawatanQuery = `
    CREATE TABLE IF NOT EXISTS log_perawatan (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tanaman_id INT NOT NULL,
      santri_id INT NOT NULL,
      jenis_tindakan ENUM('siram', 'pupuk', 'panen') NOT NULL,
      waktu_tindakan TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tanaman_id) REFERENCES tanaman(id) ON DELETE CASCADE,
      FOREIGN KEY (santri_id) REFERENCES pendaftar_santri(id) ON DELETE CASCADE
    )
  `;
  db.query(createLogPerawatanQuery, (err) => {
    if (err) console.error("❌ Gagal membuat tabel log_perawatan:", err);
    else {
      console.log("✅ Tabel 'log_perawatan' siap digunakan.");
      db.query("ALTER TABLE log_perawatan MODIFY COLUMN jenis_tindakan ENUM('siram', 'pupuk', 'panen') NOT NULL", (e) => {
        if (e) console.log("Info kolom log_perawatan: ", e.message);
      });
    }
  });
  const createFotoPerkembanganQuery = `
    CREATE TABLE IF NOT EXISTS foto_perkembangan (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tanaman_id INT NOT NULL,
      santri_id INT,
      petani_id INT,
      gambar VARCHAR(255) NOT NULL,
      waktu_upload TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tanaman_id) REFERENCES tanaman(id) ON DELETE CASCADE
    )
  `;
  db.query(createFotoPerkembanganQuery, (err) => {
    if (err) console.error("❌ Gagal membuat tabel foto_perkembangan:", err);
    else console.log("✅ Tabel 'foto_perkembangan' siap digunakan.");
  });

  // Auto-create tabel users
  const createUsersQuery = `
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nama_lengkap VARCHAR(255) NOT NULL,
      username VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role ENUM('santri', 'guru', 'petugas') NOT NULL,
      status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `;
  db.query(createUsersQuery, (err) => {
    if (err) console.error("❌ Gagal membuat tabel users:", err);
    else console.log("✅ Tabel 'users' siap digunakan.");
  });

  // Auto-create tabel riwayat_perawatan
  const createRiwayatPerawatanQuery = `
    CREATE TABLE IF NOT EXISTS riwayat_perawatan (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tanaman_id INT NOT NULL,
      user_id INT NOT NULL,
      tipe_aksi ENUM('siram', 'pupuk', 'panen') NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tanaman_id) REFERENCES tanaman(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `;
  db.query(createRiwayatPerawatanQuery, (err) => {
    if (err) console.error("❌ Gagal membuat tabel riwayat_perawatan:", err);
    else console.log("✅ Tabel 'riwayat_perawatan' siap digunakan.");
  });
});

// Contoh Jalur (Endpoint) Testing
app.get('/api/test', (req, res) => {
  res.json({ message: 'Halo! Backend Node.js berhasil berjalan dan terhubung ke DB.' });
});

// ==========================================
// API PENDAFTARAN SANTRI (PUBLIC & AUTO-LOGIN)
// ==========================================

// 1. Submit Pendaftaran
app.post("/api/pendaftaran", async (req, res) => {
  const { nama, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat, no_wa, email, username, password } = req.body;

  try {
    db.query("SELECT * FROM pendaftar_santri WHERE username = ?", [username], async (err, results) => {
      if (err) return res.status(500).json({ message: "Terjadi kesalahan server saat cek username." });
      
      if (results.length > 0) {
        return res.status(400).json({ message: "Username sudah digunakan, silakan pilih yang lain." });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const sql = `INSERT INTO pendaftar_santri (nama, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat, no_wa, email, username, password) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const values = [nama, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat, no_wa, email, username, hashedPassword];
      
      db.query(sql, values, (err, insertResult) => {
        if (err) return res.status(500).json({ message: "Gagal menyimpan data ke database.", error: err.message });

        const token = jwt.sign({ id: insertResult.insertId, username }, JWT_SECRET, { expiresIn: '30d' });
        res.status(201).json({ message: "Pendaftaran Berhasil", token });
      });
    });
  } catch (err) {
    res.status(500).json({ message: "Terjadi kesalahan server." });
  }
});


// Middleware untuk mengecek token santri/petani
const authenticateSantriToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: "Akses ditolak. Belum login." });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Token tidak valid atau sudah kadaluarsa." });
    req.user = user;
    next();
  });
};

// 1.5 Login Santri
app.post("/api/pendaftaran/login", (req, res) => {
  const { username, password } = req.body;
  
  db.query("SELECT * FROM pendaftar_santri WHERE username = ?", [username], async (err, results) => {
    if (err) return res.status(500).json({ message: "Terjadi kesalahan server saat login." });
    
    if (results.length === 0) {
      return res.status(401).json({ message: "Username tidak ditemukan." });
    }
    
    const user = results[0];
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(401).json({ message: "Password salah." });
    }
    
    const token = jwt.sign({ id: user.id, username: user.username, role: 'Santri' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ message: "Login berhasil", token });
  });
});


// 2. Cek Status Pendaftaran (Auto-Login)
app.get("/api/pendaftaran/status", authenticateSantriToken, (req, res) => {
  const sql = "SELECT id, nama, tempat_lahir, DATE_FORMAT(tanggal_lahir, '%Y-%m-%d') as tanggal_lahir, jenis_kelamin, alamat, no_wa, email, username, status_pendaftaran FROM pendaftar_santri WHERE id = ?";
  
  db.query(sql, [req.user.id], (err, results) => {
    if (err) return res.status(500).json({ message: "Terjadi kesalahan saat mengambil status." });
    
    if (results.length === 0) {
      return res.status(404).json({ message: "Data tidak ditemukan." });
    }

    res.json(results[0]);
  });
});

// ==========================================
// API MANAJEMEN PENDAFTAR (ADMIN)
// ==========================================

app.get('/api/pendaftar_santri', (req, res) => {
  db.query("SELECT * FROM pendaftar_santri ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.put('/api/pendaftar_santri/:id/status', (req, res) => {
  const { status } = req.body;
  const query = "UPDATE pendaftar_santri SET status_pendaftaran = ? WHERE id = ?";
  
  db.query(query, [status, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: `Status santri diperbarui menjadi ${status}` });
  });
});

app.delete('/api/pendaftar_santri/:id', (req, res) => {
  db.query("DELETE FROM pendaftar_santri WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Data santri berhasil dihapus" });
  });
});

// ==========================================
// API PROGRAMS (PROGRAM PENDAFTARAN)
// ==========================================

app.get('/api/programs', (req, res) => {
  db.query("SELECT * FROM program_pendaftaran ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.post('/api/programs', upload.single('poster'), (req, res) => {
  const { judul, jenis, nama, status, batas_akhir, keterangan } = req.body;
  const poster = req.file ? req.file.filename : null;
  
  const query = "INSERT INTO program_pendaftaran (judul, jenis, nama, status, batas_akhir, keterangan, poster) VALUES (?, ?, ?, ?, ?, ?, ?)";
  db.query(query, [judul, jenis, nama, status, batas_akhir, keterangan, poster], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Program berhasil ditambahkan", id: results.insertId });
  });
});

app.put('/api/programs/:id', upload.single('poster'), (req, res) => {
  const { judul, jenis, nama, status, batas_akhir, keterangan } = req.body;
  
  if (req.file) {
    const poster = req.file.filename;
    const query = "UPDATE program_pendaftaran SET judul=?, jenis=?, nama=?, status=?, batas_akhir=?, keterangan=?, poster=? WHERE id=?";
    db.query(query, [judul, jenis, nama, status, batas_akhir, keterangan, poster, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Program beserta poster berhasil diperbarui" });
    });
  } else {
    const query = "UPDATE program_pendaftaran SET judul=?, jenis=?, nama=?, status=?, batas_akhir=?, keterangan=? WHERE id=?";
    db.query(query, [judul, jenis, nama, status, batas_akhir, keterangan, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Program berhasil diperbarui" });
    });
  }
});

app.put('/api/programs/:id/status', (req, res) => {
  const { status } = req.body;
  const query = "UPDATE program_pendaftaran SET status = ? WHERE id = ?";
  
  db.query(query, [status, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: `Status program diperbarui menjadi ${status}` });
  });
});

app.delete('/api/programs/:id', (req, res) => {
  db.query("DELETE FROM program_pendaftaran WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Program berhasil dihapus" });
  });
});

// ==========================================
// API GALERI
// ==========================================

app.get('/api/galeri', (req, res) => {
  db.query("SELECT * FROM galeri ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.post('/api/galeri', upload.single('image'), (req, res) => {
  const { title, description, category } = req.body;
  const image_url = req.file ? req.file.filename : null;
  if (!image_url) return res.status(400).json({ error: "Image is required" });
  
  const query = "INSERT INTO galeri (title, description, category, image_url) VALUES (?, ?, ?, ?)";
  db.query(query, [title, description, category, image_url], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Foto berhasil ditambahkan", id: results.insertId });
  });
});

app.delete('/api/galeri/:id', (req, res) => {
  const query = "DELETE FROM galeri WHERE id = ?";
  db.query(query, [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Foto berhasil dihapus" });
  });
});

// ==========================================
// API RESERVASI
// ==========================================

// Ambil Semua Reservasi (Untuk Dashboard Admin)
app.get('/api/reservasi', (req, res) => {
  db.query("SELECT * FROM reservasi ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// Buat Reservasi Baru (Dari Form Website Utama)
app.post('/api/reservasi', (req, res) => {
  const { nama, whatsapp, email, instansi, tanggal, jumlah, pesan } = req.body;
  const query = "INSERT INTO reservasi (nama, whatsapp, email, instansi, tanggal, jumlah, pesan) VALUES (?, ?, ?, ?, ?, ?, ?)";
  
  db.query(query, [nama, whatsapp, email, instansi, tanggal, jumlah, pesan], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Reservasi berhasil dikirim!", id: results.insertId });
  });
});

// Ubah Status Reservasi (Terima / Tolak dari Admin)
app.put('/api/reservasi/:id/status', (req, res) => {
  const { status } = req.body;
  const query = "UPDATE reservasi SET status = ? WHERE id = ?";
  
  db.query(query, [status, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: `Status reservasi diperbarui menjadi ${status}` });
  });
});

// Hapus Reservasi (Dari Admin Dashboard)
app.delete('/api/reservasi/:id', (req, res) => {
  const query = "DELETE FROM reservasi WHERE id = ?";
  
  db.query(query, [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Data reservasi berhasil dihapus dari MySQL" });
  });
});

// ==========================================
// API PAKET WISATA
// ==========================================

// Ambil Semua Paket
app.get('/api/paket', (req, res) => {
  db.query("SELECT * FROM paket_wisata", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// Update Paket (Harga, Nama, Deskripsi)
app.put('/api/paket/:id', (req, res) => {
  const { nama_paket, harga, deskripsi } = req.body;
  const query = "UPDATE paket_wisata SET nama_paket = ?, harga = ?, deskripsi = ? WHERE id = ?";
  
  db.query(query, [nama_paket, harga, deskripsi, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Data paket wisata berhasil diperbarui" });
  });
});

// Tambah Paket Baru
app.post('/api/paket', (req, res) => {
  const { nama_paket, harga, deskripsi } = req.body;
  const query = "INSERT INTO paket_wisata (nama_paket, harga, deskripsi) VALUES (?, ?, ?)";
  
  db.query(query, [nama_paket, harga, deskripsi], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Paket wisata berhasil ditambahkan", id: results.insertId });
  });
});

// Hapus Paket
app.delete('/api/paket/:id', (req, res) => {
  const query = "DELETE FROM paket_wisata WHERE id = ?";
  
  db.query(query, [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Data paket wisata berhasil dihapus dari MySQL" });
  });
});

// ==========================================
// API EVENTS & KEGIATAN
// ==========================================

// Ambil Semua Event
app.get('/api/events', (req, res) => {
  db.query("SELECT * FROM events ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// Tambah Event Baru (dengan upload gambar)
app.post('/api/events', upload.single('image'), (req, res) => {
  const { title, category, date, description } = req.body;
  const image = req.file ? req.file.filename : null;
  
  const query = "INSERT INTO events (title, category, date, description, image) VALUES (?, ?, ?, ?, ?)";
  db.query(query, [title, category, date, description, image], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Event berhasil ditambahkan", id: results.insertId });
  });
});

// Update Event (termasuk optional ganti gambar)
app.put('/api/events/:id', upload.single('image'), (req, res) => {
  const { title, category, date, description } = req.body;
  
  if (req.file) {
    const image = req.file.filename;
    const query = "UPDATE events SET title=?, category=?, date=?, description=?, image=? WHERE id=?";
    db.query(query, [title, category, date, description, image, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Event beserta gambar berhasil diperbarui" });
    });
  } else {
    const query = "UPDATE events SET title=?, category=?, date=?, description=? WHERE id=?";
    db.query(query, [title, category, date, description, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Event berhasil diperbarui" });
    });
  }
});

// Hapus Event
app.delete('/api/events/:id', (req, res) => {
  db.query("DELETE FROM events WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Event berhasil dihapus" });
  });
});

// ==========================================
// API BLOG GRID
// ==========================================

// Ambil Semua Blog
app.get('/api/blogs', (req, res) => {
  db.query("SELECT * FROM blogs ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// Tambah Blog Baru
app.post('/api/blogs', upload.single('image'), (req, res) => {
  const { title, date, excerpt, content } = req.body;
  const image = req.file ? req.file.filename : null;
  
  const query = "INSERT INTO blogs (title, date, excerpt, content, image) VALUES (?, ?, ?, ?, ?)";
  db.query(query, [title, date, excerpt, content, image], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Blog berhasil ditambahkan", id: results.insertId });
  });
});

// Update Blog
app.put('/api/blogs/:id', upload.single('image'), (req, res) => {
  const { title, date, excerpt, content } = req.body;
  
  if (req.file) {
    const image = req.file.filename;
    const query = "UPDATE blogs SET title=?, date=?, excerpt=?, content=?, image=? WHERE id=?";
    db.query(query, [title, date, excerpt, content, image, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Blog beserta gambar berhasil diperbarui" });
    });
  } else {
    const query = "UPDATE blogs SET title=?, date=?, excerpt=?, content=? WHERE id=?";
    db.query(query, [title, date, excerpt, content, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Blog berhasil diperbarui" });
    });
  }
});

// Hapus Blog
app.delete('/api/blogs/:id', (req, res) => {
  db.query("DELETE FROM blogs WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Blog berhasil dihapus" });
  });
});

// ==========================================
// API LAYANAN
// ==========================================

// Ambil Semua Layanan
app.get('/api/layanan', (req, res) => {
  db.query("SELECT * FROM layanan ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// Ambil Satu Layanan berdasarkan ID
app.get('/api/layanan/:id', (req, res) => {
  db.query("SELECT * FROM layanan WHERE id = ?", [req.params.id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ error: "Layanan tidak ditemukan" });
    res.json(results[0]);
  });
});

// Tambah Layanan Baru
app.post('/api/layanan', upload.single('image'), (req, res) => {
  const { title, description } = req.body;
  const image = req.file ? req.file.filename : null;
  db.query("INSERT INTO layanan (title, description, image) VALUES (?, ?, ?)", [title, description, image], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Layanan berhasil ditambahkan", id: results.insertId });
  });
});

// Update Layanan
app.put('/api/layanan/:id', upload.single('image'), (req, res) => {
  const { title, description } = req.body;
  if (req.file) {
    db.query("UPDATE layanan SET title=?, description=?, image=? WHERE id=?", [title, description, req.file.filename, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Layanan berhasil diperbarui" });
    });
  } else {
    db.query("UPDATE layanan SET title=?, description=? WHERE id=?", [title, description, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Layanan berhasil diperbarui" });
    });
  }
});

// Hapus Layanan
app.delete('/api/layanan/:id', (req, res) => {
  db.query("DELETE FROM layanan WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Layanan berhasil dihapus" });
  });
});

// ==========================================
// API APPOINTMENTS
// ==========================================

// Ambil Semua Appointments (Untuk Dashboard Admin)
app.get('/api/appointments', (req, res) => {
  db.query("SELECT * FROM appointments ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// Buat Appointment Baru (Dari Form Website Utama)
app.post('/api/appointments', (req, res) => {
  const { name, number, email, address, message } = req.body;
  const query = "INSERT INTO appointments (name, number, email, address, message) VALUES (?, ?, ?, ?, ?)";
  
  db.query(query, [name, number, email, address, message], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Appointment berhasil dikirim!", id: results.insertId });
  });
});

// Ubah Status Appointment (Terima / Tolak dari Admin)
app.put('/api/appointments/:id/status', (req, res) => {
  const { status } = req.body;
  const query = "UPDATE appointments SET status = ? WHERE id = ?";
  
  db.query(query, [status, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: `Status appointment diperbarui menjadi ${status}` });
  });
});

// Hapus Appointment (Dari Admin Dashboard)
app.delete('/api/appointments/:id', (req, res) => {
  const query = "DELETE FROM appointments WHERE id = ?";
  
  db.query(query, [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Data appointment berhasil dihapus dari MySQL" });
  });
});

// ==========================================
// API AUTENTIKASI
// ==========================================
app.post('/api/register', async (req, res) => {
  const { nama_lengkap, username, password, role } = req.body;
  if (!nama_lengkap || !username || !password || !role) {
    return res.status(400).json({ message: "Semua field harus diisi!" });
  }

  try {
    db.query("SELECT * FROM users WHERE username = ?", [username], async (err, results) => {
      if (err) return res.status(500).json({ message: "Terjadi kesalahan server saat cek username." });
      
      if (results.length > 0) {
        return res.status(400).json({ message: "Username sudah digunakan." });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const sql = "INSERT INTO users (nama_lengkap, username, password, role, status) VALUES (?, ?, ?, ?, 'pending')";
      db.query(sql, [nama_lengkap, username, hashedPassword, role], (err, insertResult) => {
        if (err) return res.status(500).json({ message: "Gagal register", error: err.message });
        res.status(201).json({ message: "Registrasi Berhasil. Menunggu persetujuan Admin." });
      });
    });
  } catch (err) {
    res.status(500).json({ message: "Terjadi kesalahan server." });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  // Coba cek di tabel users
  db.query("SELECT * FROM users WHERE username = ?", [username], async (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    
    if (results.length > 0) {
      const user = results[0];
      
      if (user.status !== 'approved') {
        return res.status(403).json({ error: "Akun Anda belum disetujui oleh Admin. Harap tunggu konfirmasi." });
      }
      
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return res.status(401).json({ error: "Password salah!" });
      
      const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1d' });
      return res.json({ 
        message: "Login berhasil", 
        token,
        user: { id: user.id, nama_lengkap: user.nama_lengkap, role: user.role }
      });
    }
    
    // Jika tidak ada di users, cek di admin_users
    db.query("SELECT * FROM admin_users WHERE username = ?", [username], async (errAdmin, resultsAdmin) => {
      if (errAdmin) return res.status(500).json({ error: errAdmin.message });
      
      if (resultsAdmin.length === 0) {
        return res.status(401).json({ error: "Username tidak ditemukan!" });
      }
      
      const admin = resultsAdmin[0];
      const isMatch = await bcrypt.compare(password, admin.password);
      
      if (!isMatch) {
        return res.status(401).json({ error: "Password salah!" });
      }
      
      const token = jwt.sign({ id: admin.id, username: admin.username, role: 'admin' }, JWT_SECRET, { expiresIn: '1d' });
      res.json({ 
        message: "Login admin berhasil", 
        token,
        user: { id: admin.id, nama_lengkap: 'Administrator', role: 'admin' }
      });
    });
  });
});

// Auth Middleware
const authenticateUserToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: "Akses ditolak. Belum login." });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Token tidak valid atau sudah kadaluarsa." });
    req.user = user;
    next();
  });
};

// ==========================================
// API ADMIN - MANAJEMEN USER (APPROVAL)
// ==========================================
app.get('/api/admin/users', (req, res) => {
  db.query("SELECT id, nama_lengkap, username, role, status, created_at FROM users ORDER BY created_at DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.put('/api/admin/users/:id/approve', (req, res) => {
  db.query("UPDATE users SET status = 'approved' WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "User berhasil disetujui" });
  });
});

app.delete('/api/admin/users/:id/reject', (req, res) => {
  db.query("DELETE FROM users WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "User berhasil ditolak & dihapus" });
  });
});

// Endpoint untuk upload gambar sisipan dari React Quill
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Gagal mengupload gambar" });
  }
  // Kembalikan URL gambar agar bisa dirender oleh React Quill
  // Jika app berjalan di production (misal alfilaha.id), URL ini idealnya dinamis
  const protocol = req.protocol;
  const host = req.get('host');
  const imageUrl = `${protocol}://${host}/uploads/${req.file.filename}`;
  res.json({ url: imageUrl });
});

// ==========================================
// API TANAMAN
// ==========================================
app.get('/api/tanaman', (req, res) => {
  db.query("SELECT * FROM tanaman ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
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
  const { nama, jenis, lokasi, deskripsi, kondisi, usia, jadwal_siram, jadwal_pupuk, jadwal_panen, penanggung_jawab, kebutuhan_air, terakhir_dipupuk } = req.body;
  const gambar = req.file ? req.file.filename : null;
  db.query("INSERT INTO tanaman (nama, jenis, lokasi, deskripsi, kondisi, gambar, usia, jadwal_siram, jadwal_pupuk, jadwal_panen, penanggung_jawab, kebutuhan_air, terakhir_dipupuk) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [nama, jenis, lokasi, deskripsi, kondisi || 'Sehat', gambar, usia, jadwal_siram, jadwal_pupuk, jadwal_panen, penanggung_jawab, kebutuhan_air, terakhir_dipupuk], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Berhasil", id: results.insertId });
  });
});

app.put('/api/tanaman/:id', upload.single('gambar'), (req, res) => {
  const { nama, jenis, lokasi, deskripsi, kondisi, usia, jadwal_siram, jadwal_pupuk, jadwal_panen, penanggung_jawab, kebutuhan_air, terakhir_dipupuk } = req.body;
  if (req.file) {
    db.query("UPDATE tanaman SET nama=?, jenis=?, lokasi=?, deskripsi=?, kondisi=?, gambar=?, usia=?, jadwal_siram=?, jadwal_pupuk=?, jadwal_panen=?, penanggung_jawab=?, kebutuhan_air=?, terakhir_dipupuk=? WHERE id=?", [nama, jenis, lokasi, deskripsi, kondisi || 'Sehat', req.file.filename, usia, jadwal_siram, jadwal_pupuk, jadwal_panen, penanggung_jawab, kebutuhan_air, terakhir_dipupuk, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Berhasil" });
    });
  } else {
    db.query("UPDATE tanaman SET nama=?, jenis=?, lokasi=?, deskripsi=?, kondisi=?, usia=?, jadwal_siram=?, jadwal_pupuk=?, jadwal_panen=?, penanggung_jawab=?, kebutuhan_air=?, terakhir_dipupuk=? WHERE id=?", [nama, jenis, lokasi, deskripsi, kondisi || 'Sehat', usia, jadwal_siram, jadwal_pupuk, jadwal_panen, penanggung_jawab, kebutuhan_air, terakhir_dipupuk, req.params.id], (err) => {
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

// ==========================================
// API LOG PERAWATAN
// ==========================================
app.get('/api/log_perawatan', (req, res) => {
  const { tanaman_id } = req.query;
  let query = `
    SELECT 
      r.id, 
      r.tanaman_id, 
      r.tipe_aksi AS jenis_tindakan, 
      r.created_at AS waktu_tindakan, 
      NULL AS gambar,
      t.nama AS nama_tanaman, 
      u.nama_lengkap AS nama_santri, 
      u.role AS role_perawat 
    FROM riwayat_perawatan r 
    JOIN tanaman t ON r.tanaman_id = t.id
    JOIN users u ON r.user_id = u.id
  `;
  const params = [];
  
  if (tanaman_id) {
    query += ` WHERE r.tanaman_id = ? `;
    params.push(tanaman_id);
  }
  
  query += ` ORDER BY r.created_at DESC `;
  
  db.query(query, params, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.post('/api/log_perawatan', upload.single('gambar'), (req, res) => {
  const { tanaman_id, jenis_tindakan, nama_perawat, role_perawat } = req.body;
  const gambar = req.file ? req.file.filename : null;
  
  const finalNama = nama_perawat || "Pengunjung";
  const finalRole = role_perawat || "Pengunjung";

  db.query("INSERT INTO log_perawatan (tanaman_id, perawat_id, role_perawat, jenis_tindakan, gambar, nama_perawat) VALUES (?, ?, ?, ?, ?, ?)", [tanaman_id, 0, finalRole, jenis_tindakan, gambar, finalNama], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Perawatan berhasil dicatat" });
  });
});
// API FOTO PERKEMBANGAN
app.get('/api/foto_perkembangan/:tanaman_id', (req, res) => {
  const query = `
    SELECT *
    FROM foto_perkembangan
    WHERE tanaman_id = ?
    ORDER BY waktu_upload ASC
  `;
  db.query(query, [req.params.tanaman_id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.post('/api/foto_perkembangan', authenticateSantriToken, upload.single('gambar'), (req, res) => {
  const { tanaman_id } = req.body;
  const user_id = req.user.id;
  const role = req.user.role || 'Santri';
  const gambar = req.file ? req.file.filename : null;
  
  if (!gambar) return res.status(400).json({ error: "Gambar wajib diunggah" });

  let santri_id = null;
  let petani_id = null;
  if (role === 'Petani') {
    petani_id = user_id;
  } else {
    santri_id = user_id;
  }

  db.query("INSERT INTO foto_perkembangan (tanaman_id, santri_id, petani_id, gambar) VALUES (?, ?, ?, ?)", [tanaman_id, santri_id, petani_id, gambar], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Foto perkembangan berhasil diunggah", id: results.insertId, gambar });
  });
});

// ==========================================
// API RIWAYAT PERAWATAN
// ==========================================
app.post('/api/tanaman/:id/aksi', authenticateUserToken, (req, res) => {
  const { tipe_aksi } = req.body;
  const tanaman_id = req.params.id;
  const user_id = req.user.id;

  if (!['siram', 'pupuk', 'panen'].includes(tipe_aksi)) {
    return res.status(400).json({ error: "tipe_aksi tidak valid" });
  }

  const query = "INSERT INTO riwayat_perawatan (tanaman_id, user_id, tipe_aksi) VALUES (?, ?, ?)";
  db.query(query, [tanaman_id, user_id, tipe_aksi], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Aksi perawatan berhasil dicatat", id: results.insertId });
  });
});

app.get('/api/tanaman/:id/riwayat', (req, res) => {
  const tanaman_id = req.params.id;
  const query = `
    SELECT r.id, r.tipe_aksi, u.nama_lengkap, u.role, r.created_at
    FROM riwayat_perawatan r
    JOIN users u ON r.user_id = u.id
    WHERE r.tanaman_id = ?
    ORDER BY r.created_at DESC
  `;
  db.query(query, [tanaman_id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// Menyalakan Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server Backend berjalan di http://localhost:${PORT}`);
});
