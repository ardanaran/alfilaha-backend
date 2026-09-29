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
    `CREATE TABLE IF NOT EXISTS log_perawatan (id INT AUTO_INCREMENT PRIMARY KEY, tanaman_id INT NOT NULL, santri_id INT NOT NULL, jenis_tindakan ENUM('siram', 'pupuk') NOT NULL, waktu_tindakan TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (tanaman_id) REFERENCES tanaman(id) ON DELETE CASCADE, FOREIGN KEY (santri_id) REFERENCES pendaftar_santri(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS foto_perkembangan (id INT AUTO_INCREMENT PRIMARY KEY, tanaman_id INT NOT NULL, santri_id INT NOT NULL, gambar VARCHAR(255) NOT NULL, waktu_upload TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (tanaman_id) REFERENCES tanaman(id) ON DELETE CASCADE, FOREIGN KEY (santri_id) REFERENCES pendaftar_santri(id) ON DELETE CASCADE)`
  ];
  
  tables.forEach(q => db.query(q, (err) => { if (err) console.error(err); }));
  
  // Update paket_wisata table if needed
  db.query("ALTER TABLE paket_wisata ADD COLUMN gambar VARCHAR(255)", (err) => {
    // Ignore error if column already exists
  });
});

app.get('/api/test', (req, res) => {
  res.json({ message: 'Halo!' });
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
    res.json({ message: "Login berhasil", token, user: { id: user.id, nama: user.nama, username: user.username, status_pendaftaran: user.status_pendaftaran } });
  });
});

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
        // Bila update gagal tapi file baru sudah tersimpan, jangan biarkan file yatim
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

// LOG PERAWATAN
app.get('/api/log_perawatan', (req, res) => {
  const query = `
    SELECT l.id, l.tanaman_id, l.jenis_tindakan, l.waktu_tindakan, t.nama AS nama_tanaman, s.nama AS nama_santri 
    FROM log_perawatan l 
    JOIN tanaman t ON l.tanaman_id = t.id 
    JOIN pendaftar_santri s ON l.santri_id = s.id 
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
    SELECT s.*, p.nama AS nama_penanggung
    FROM activity_schedules s
    LEFT JOIN pendaftar_santri p ON s.penanggung_jawab = p.id
    WHERE s.status = 'aktif'
      AND s.tanggal_mulai <= ?
      AND (s.tanggal_selesai IS NULL OR s.tanggal_selesai >= ?)
  `;
  db.query(qAktif, [todayStr, todayStr], (err, schedules) => {
    if (err) { console.error('[CRON] Query jadwal aktif gagal:', err.message); return; }

    schedules.forEach((sch) => {
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

      // Insert tiket — IGNORE jika sudah ada (UNIQUE KEY)
      const qInsert = `
        INSERT IGNORE INTO activity_tasks
          (schedule_id, santri_id, nama_santri, tanggal_tugas, status)
        VALUES (?, ?, ?, ?, 'pending')
      `;
      db.query(qInsert, [sch.id, sch.penanggung_jawab, sch.nama_penanggung, todayStr], (err) => {
        if (err) console.error(`[CRON] Gagal buat tiket schedule ${sch.id}:`, err.message);
        else console.log(`[CRON] ✅ Tiket dibuat: schedule=${sch.id} | santri=${sch.nama_penanggung} | ${todayStr}`);
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

// GET health-check untuk tabel jadwal — dipakai frontend sebelum menyimpan
app.get('/api/jadwal-test', (req, res) => {
  db.query('SELECT COUNT(*) AS total FROM activity_schedules', (err) => {
    if (err) {
      console.error('[/api/jadwal-test] Tabel belum ada:', err.message);
      return res.status(200).json({ ok: false, activity_schedules_exists: false, error: err.message });
    }
    res.json({ ok: true, activity_schedules_exists: true });
  });
});

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

// GET semua jadwal + nama penanggung jawab, kategori, lokasi
app.get('/api/jadwal', (req, res) => {
  const q = `
    SELECT s.*, 
           p.nama AS nama_pj, 
           p.username AS username_pj,
           k.nama AS nama_kategori,
           l.nama AS nama_lokasi
    FROM activity_schedules s
    LEFT JOIN pendaftar_santri p ON s.penanggung_jawab = p.id
    LEFT JOIN kategori k ON s.kategori_id = k.id
    LEFT JOIN lokasi l ON s.lokasi_id = l.id
    ORDER BY s.id DESC
  `;
  db.query(q, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// GET detail satu jadwal dengan relasi lengkap
app.get('/api/jadwal/:id', (req, res) => {
  const q = `
    SELECT s.*, 
           p.nama AS nama_pj,
           k.nama AS nama_kategori,
           l.nama AS nama_lokasi
    FROM activity_schedules s
    LEFT JOIN pendaftar_santri p ON s.penanggung_jawab = p.id
    LEFT JOIN kategori k ON s.kategori_id = k.id
    LEFT JOIN lokasi l ON s.lokasi_id = l.id
    WHERE s.id = ?
  `;
  db.query(q, [req.params.id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ message: 'Tidak ditemukan' });
    
    const jadwal = results[0];
    
    // Ambil tanaman terkait
    db.query(
      `SELECT t.* FROM tanaman t 
       JOIN aktivitas_tanaman at ON t.id = at.tanaman_id 
       WHERE at.aktivitas_id = ?`,
      [req.params.id],
      (err, tanamanResults) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Ambil santri terkait
        db.query(
          `SELECT s.id, s.nama, s.username FROM pendaftar_santri s
           JOIN aktivitas_santri asa ON s.id = asa.santri_id
           WHERE asa.aktivitas_id = ?`,
          [req.params.id],
          (err, santriResults) => {
            if (err) return res.status(500).json({ error: err.message });
            
            res.json({
              ...jadwal,
              tanaman: tanamanResults,
              santri: santriResults
            });
          }
        );
      }
    );
  });
});

// GET jadwal santri - hanya jadwal yang terhubung ke santri yang login
app.get('/api/jadwal-santri', (req, res) => {
  const santri_id = req.query.santri_id;
  
  if (!santri_id) {
    return res.status(400).json({ error: 'santri_id diperlukan' });
  }
  
  // Verifikasi santri ada dan status diterima
  db.query('SELECT id, nama, status_pendaftaran FROM pendaftar_santri WHERE id = ?', [santri_id], (err, santriResults) => {
    if (err) return res.status(500).json({ error: err.message });
    if (santriResults.length === 0) return res.status(404).json({ error: 'Santri tidak ditemukan' });
    if (santriResults[0].status_pendaftaran !== 'Diterima') return res.status(403).json({ error: 'Santri belum diterima' });
    
    // Ambil jadwal yang terhubung ke santri ini (melalui aktivitas_santri)
    const q = `
      SELECT s.*, 
             k.nama AS nama_kategori,
             l.nama AS nama_lokasi
      FROM activity_schedules s
      JOIN aktivitas_santri asa ON s.id = asa.aktivitas_id
      LEFT JOIN kategori k ON s.kategori_id = k.id
      LEFT JOIN lokasi l ON s.lokasi_id = l.id
      WHERE asa.santri_id = ? AND s.status = 'aktif'
      ORDER BY s.tanggal_mulai DESC
    `;
    
    db.query(q, [santri_id], (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    });
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

// POST buat jadwal baru — mendukung struktur baru dengan lokasi, kegiatan, tanaman, dan multi-santri
app.post('/api/jadwal', (req, res) => {
  const { 
    nama_aktivitas, 
    kategori_id, 
    lokasi_id, 
    kegiatan_lokasi_ids, 
    tanaman_ids, 
    jam_mulai, 
    jam_selesai, 
    pola_perulangan, 
    interval_hari, 
    tanggal_mulai, 
    tanggal_selesai, 
    deskripsi, 
    santri_ids 
  } = req.body;
  
  console.log('[POST /api/jadwal] Menerima:', { 
    nama_aktivitas, 
    kategori_id, 
    lokasi_id, 
    kegiatan_lokasi_ids, 
    tanaman_ids, 
    santri_ids, 
    pola_perulangan, 
    tanggal_mulai 
  });
  
  // Validasi input dasar
  if (!nama_aktivitas || !kategori_id || !lokasi_id) {
    return res.status(400).json({ error: 'Nama aktivitas, kategori, dan lokasi diperlukan' });
  }
  
  if (!kegiatan_lokasi_ids || !Array.isArray(kegiatan_lokasi_ids) || kegiatan_lokasi_ids.length === 0) {
    return res.status(400).json({ error: 'Minimal satu kegiatan harus dipilih' });
  }
  
  if (!santri_ids || !Array.isArray(santri_ids) || santri_ids.length === 0) {
    return res.status(400).json({ error: 'Minimal satu santri harus dipilih' });
  }
  
  const interval = pola_perulangan === 'harian'   ? 1
                 : pola_perulangan === 'mingguan'  ? 7
                 : pola_perulangan === 'bulanan'   ? 30
                 : parseInt(interval_hari) || 7;

  // Start transaction
  db.beginTransaction((err) => {
    if (err) {
      console.error('[POST /api/jadwal] Transaction error:', err.message);
      return res.status(500).json({ error: err.message });
    }

    // 1. Verifikasi kategori ada
    db.query('SELECT id, nama FROM kategori WHERE id = ? AND aktif = 1', [kategori_id], (err, kategoriResults) => {
      if (err) {
        return db.rollback(() => res.status(500).json({ error: err.message }));
      }
      if (kategoriResults.length === 0) {
        return db.rollback(() => res.status(400).json({ error: 'Kategori tidak ditemukan atau tidak aktif' }));
      }

      // 2. Verifikasi lokasi ada
      db.query('SELECT id, nama FROM lokasi WHERE id = ? AND aktif = 1', [lokasi_id], (err, lokasiResults) => {
        if (err) {
          return db.rollback(() => res.status(500).json({ error: err.message }));
        }
        if (lokasiResults.length === 0) {
          return db.rollback(() => res.status(400).json({ error: 'Lokasi tidak ditemukan atau tidak aktif' }));
        }

        // 3. Verifikasi semua kegiatan ada dan milik lokasi yang dipilih
        const kegiatanPlaceholders = kegiatan_lokasi_ids.map(() => '?').join(',');
        db.query(
          `SELECT id, lokasi_id FROM kegiatan_lokasi WHERE id IN (${kegiatanPlaceholders}) AND aktif = 1`,
          kegiatan_lokasi_ids,
          (err, kegiatanResults) => {
            if (err) {
              return db.rollback(() => res.status(500).json({ error: err.message }));
            }
            if (kegiatanResults.length !== kegiatan_lokasi_ids.length) {
              return db.rollback(() => res.status(400).json({ error: 'Satu atau lebih kegiatan tidak ditemukan atau tidak aktif' }));
            }
            
            // Verifikasi semua kegiatan milik lokasi yang sama
            const allKegiatanInLokasi = kegiatanResults.every(k => k.lokasi_id === parseInt(lokasi_id));
            if (!allKegiatanInLokasi) {
              return db.rollback(() => res.status(400).json({ error: 'Semua kegiatan harus berasal dari lokasi yang sama' }));
            }

            // 4. Verifikasi tanaman (jika ada) milik lokasi yang dipilih
            if (tanaman_ids && tanaman_ids.length > 0) {
              const tanamanPlaceholders = tanaman_ids.map(() => '?').join(',');
              db.query(
                `SELECT id, lokasi_id FROM tanaman WHERE id IN (${tanamanPlaceholders})`,
                tanaman_ids,
                (err, tanamanResults) => {
                  if (err) {
                    return db.rollback(() => res.status(500).json({ error: err.message }));
                  }
                  if (tanamanResults.length !== tanaman_ids.length) {
                    return db.rollback(() => res.status(400).json({ error: 'Satu atau lebih tanaman tidak ditemukan' }));
                  }
                  
                  const allTanamanInLokasi = tanamanResults.every(t => t.lokasi_id === null || t.lokasi_id === parseInt(lokasi_id));
                  if (!allTanamanInLokasi) {
                    return db.rollback(() => res.status(400).json({ error: 'Semua tanaman harus berasal dari lokasi yang sama atau tidak memiliki lokasi' }));
                  }
                  
                  continueWithTanaman();
                }
              );
            } else {
              continueWithTanaman();
            }

            function continueWithTanaman() {
              // 5. Verifikasi semua santri ada dan status diterima
              const santriPlaceholders = santri_ids.map(() => '?').join(',');
              db.query(
                `SELECT id, nama, status_pendaftaran FROM pendaftar_santri WHERE id IN (${santriPlaceholders})`,
                santri_ids,
                (err, santriResults) => {
                  if (err) {
                    return db.rollback(() => res.status(500).json({ error: err.message }));
                  }
                  if (santriResults.length !== santri_ids.length) {
                    return db.rollback(() => res.status(400).json({ error: 'Satu atau lebih santri tidak ditemukan' }));
                  }
                  
                  const allSantriDiterima = santriResults.every(s => s.status_pendaftaran === 'Diterima');
                  if (!allSantriDiterima) {
                    return db.rollback(() => res.status(400).json({ error: 'Semua santri harus memiliki status Diterima' }));
                  }

                  // 6. Untuk SETIAP kegiatan yang dicentang, buat satu aktivitas terpisah
                  let aktivitasIds = [];
                  let completedKegiatan = 0;
                  
                  kegiatan_lokasi_ids.forEach((kegiatanId, index) => {
                    // Ambil nama kegiatan
                    const kegiatan = kegiatanResults.find(k => k.id === parseInt(kegiatanId));
                    const namaKegiatan = kegiatan ? kegiatan.nama : 'Kegiatan';
                    
                    // Buat nama aktivitas yang unik
                    const namaAktivitasUnik = `${nama_aktivitas} - ${namaKegiatan}`;
                    
                    db.query(
                      `INSERT INTO activity_schedules 
                       (nama_aktivitas, kategori_id, lokasi_id, deskripsi, pola_perulangan, interval_hari, tanggal_mulai, tanggal_selesai, jam_mulai, jam_selesai, status)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aktif')`,
                      [namaAktivitasUnik, kategori_id, lokasi_id, deskripsi || null, pola_perulangan, interval,
                       tanggal_mulai, tanggal_selesai || null, jam_mulai || null, jam_selesai || null],
                      (err, result) => {
                        if (err) {
                          console.error('[POST /api/jadwal] Error inserting aktivitas:', err.message);
                          return db.rollback(() => res.status(500).json({ error: err.message }));
                        }
                        
                        const aktivitasId = result.insertId;
                        aktivitasIds.push(aktivitasId);
                        
                        // 7. Hubungkan tanaman ke aktivitas (jika ada)
                        if (tanaman_ids && tanaman_ids.length > 0) {
                          tanaman_ids.forEach(tanamanId => {
                            db.query(
                              'INSERT INTO aktivitas_tanaman (aktivitas_id, tanaman_id) VALUES (?, ?)',
                              [aktivitasId, tanamanId],
                              (err) => {
                                if (err) console.error('[POST /api/jadwal] Error linking tanaman:', err.message);
                              }
                            );
                          });
                        }
                        
                        // 8. Hubungkan santri ke aktivitas
                        santri_ids.forEach(santriId => {
                          db.query(
                            'INSERT INTO aktivitas_santri (aktivitas_id, santri_id) VALUES (?, ?)',
                            [aktivitasId, santriId],
                            (err) => {
                              if (err) console.error('[POST /api/jadwal] Error linking santri:', err.message);
                            }
                          );
                        });
                        
                        completedKegiatan++;
                        
                        // Setelah semua kegiatan selesai, generate tiket
                        if (completedKegiatan === kegiatan_lokasi_ids.length) {
                          db.commit((err) => {
                            if (err) {
                              console.error('[POST /api/jadwal] Commit error:', err.message);
                              return db.rollback(() => res.status(500).json({ error: err.message }));
                            }
                            
                            console.log(`[POST /api/jadwal] ${kegiatan_lokasi_ids.length} aktivitas berhasil dibuat dengan ID: ${aktivitasIds.join(', ')}`);
                            
                            // Generate tiket untuk setiap aktivitas
                            aktivitasIds.forEach(aktivitasId => {
                              santri_ids.forEach(santriId => {
                                const santri = santriResults.find(s => s.id === parseInt(santriId));
                                if (santri) {
                                  const sch = { 
                                    id: aktivitasId, 
                                    pola_perulangan, 
                                    interval_hari: interval, 
                                    tanggal_mulai,
                                    penanggung_jawab: santriId 
                                  };
                                  generateTiketUntukJadwal(sch, santri.nama, () => {
                                    // Jika sekali, tandai selesai
                                    if (pola_perulangan === 'sekali') {
                                      db.query("UPDATE activity_schedules SET status='selesai' WHERE id=?", [aktivitasId]);
                                    }
                                  });
                                }
                              });
                            });
                            
                            res.json({ 
                              message: `${kegiatan_lokasi_ids.length} aktivitas berhasil dibuat dan tiket sudah dikirim ke ${santri_ids.length} santri`, 
                              aktivitas_ids: aktivitasIds 
                            });
                          });
                        }
                      }
                    );
                  });
                }
              );
            }
          }
        );
      });
    });
  });
});

// PUT update jadwal — jika PJ berubah, regenerate tiket pending mendatang ke PJ baru
app.put('/api/jadwal/:id', (req, res) => {
  const { nama_aktivitas, kategori, deskripsi, pola_perulangan, interval_hari, tanggal_mulai, tanggal_selesai, penanggung_jawab, status } = req.body;
  const interval = pola_perulangan === 'harian'   ? 1
                 : pola_perulangan === 'mingguan'  ? 7
                 : pola_perulangan === 'bulanan'   ? 30
                 : parseInt(interval_hari) || 7;

  // Ambil data lama untuk cek apakah PJ berubah
  db.query('SELECT penanggung_jawab FROM activity_schedules WHERE id=?', [req.params.id], (err, oldRows) => {
    if (err) return res.status(500).json({ error: err.message });
    const oldPJ = oldRows.length ? oldRows[0].penanggung_jawab : null;

    db.query(
      `UPDATE activity_schedules SET
         nama_aktivitas=?, kategori=?, deskripsi=?, pola_perulangan=?,
         interval_hari=?, tanggal_mulai=?, tanggal_selesai=?,
         penanggung_jawab=?, status=?
       WHERE id=?`,
      [nama_aktivitas, kategori, deskripsi || null, pola_perulangan, interval,
       tanggal_mulai, tanggal_selesai || null, penanggung_jawab || null, status || 'aktif',
       req.params.id],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });

        // Jika PJ berubah dan status aktif, update tiket PENDING mendatang ke PJ baru
        // (tiket yang sudah selesai/dilewati tidak disentuh — histori tetap aman)
        if (penanggung_jawab && penanggung_jawab != oldPJ) {
          db.query('SELECT nama FROM pendaftar_santri WHERE id=?', [penanggung_jawab], (err, rows) => {
            const namaBaru = rows && rows.length ? rows[0].nama : null;
            const todayStr = toDateStr(new Date());
            db.query(
              `UPDATE activity_tasks SET santri_id=?, nama_santri=?
               WHERE schedule_id=? AND status='pending' AND tanggal_tugas >= ?`,
              [penanggung_jawab, namaBaru, req.params.id, todayStr],
              () => {}
            );
          });
        }

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
    SELECT t.*, s.nama_aktivitas, s.kategori, s.deskripsi, k.nama as nama_kategori, l.nama as nama_lokasi
    FROM activity_tasks t
    JOIN activity_schedules s ON t.schedule_id = s.id
    LEFT JOIN kategori k ON s.kategori_id = k.id
    LEFT JOIN lokasi l ON s.lokasi_id = l.id
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
    SELECT t.*, s.nama_aktivitas, s.kategori, s.deskripsi, s.pola_perulangan, k.nama as nama_kategori, l.nama as nama_lokasi
    FROM activity_tasks t
    JOIN activity_schedules s ON t.schedule_id = s.id
    LEFT JOIN kategori k ON s.kategori_id = k.id
    LEFT JOIN lokasi l ON s.lokasi_id = l.id
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

// ── ENDPOINT KATEGORI ──────────────────────────────────────────────────────────
// GET semua kategori
app.get('/api/kategori', (req, res) => {
  db.query('SELECT * FROM kategori WHERE aktif = 1 ORDER BY nama', (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// POST tambah kategori
app.post('/api/kategori', (req, res) => {
  const { nama } = req.body;
  if (!nama) return res.status(400).json({ error: 'Nama kategori diperlukan' });
  
  // Normalize nama: trim, case insensitive untuk pengecekan duplikat
  const namaNormalized = nama.trim();
  
  db.query('SELECT id FROM kategori WHERE LOWER(nama) = LOWER(?)', [namaNormalized], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length > 0) return res.status(400).json({ error: 'Nama kategori sudah ada' });
    
    db.query('INSERT INTO kategori (nama) VALUES (?)', [namaNormalized], (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: result.insertId, nama: namaNormalized, aktif: 1 });
    });
  });
});

// PUT update kategori
app.put('/api/kategori/:id', (req, res) => {
  const { nama } = req.body;
  if (!nama) return res.status(400).json({ error: 'Nama kategori diperlukan' });
  
  const namaNormalized = nama.trim();
  
  db.query('SELECT id FROM kategori WHERE LOWER(nama) = LOWER(?) AND id != ?', [namaNormalized, req.params.id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length > 0) return res.status(400).json({ error: 'Nama kategori sudah ada' });
    
    db.query('UPDATE kategori SET nama = ? WHERE id = ?', [namaNormalized, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Kategori diperbarui' });
    });
  });
});

// DELETE/hapus kategori (soft delete)
app.delete('/api/kategori/:id', (req, res) => {
  // Cek apakah kategori masih dipakai
  db.query('SELECT COUNT(*) as count FROM activity_schedules WHERE kategori_id = ?', [req.params.id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results[0].count > 0) {
      return res.status(400).json({ error: 'Kategori masih digunakan oleh jadwal aktivitas' });
    }
    
    db.query('UPDATE kategori SET aktif = 0 WHERE id = ?', [req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Kategori dinonaktifkan' });
    });
  });
});

// ── ENDPOINT LOKASI ───────────────────────────────────────────────────────────
// GET semua lokasi
app.get('/api/lokasi', (req, res) => {
  db.query('SELECT * FROM lokasi WHERE aktif = 1 ORDER BY nama', (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// GET detail lokasi dengan tanaman, kegiatan, dan aktivitas
app.get('/api/lokasi/:id', (req, res) => {
  const lokasiId = req.params.id;
  
  // Ambil detail lokasi
  db.query('SELECT * FROM lokasi WHERE id = ?', [lokasiId], (err, lokasiResults) => {
    if (err) return res.status(500).json({ error: err.message });
    if (lokasiResults.length === 0) return res.status(404).json({ error: 'Lokasi tidak ditemukan' });
    
    const lokasi = lokasiResults[0];
    
    // Ambil kegiatan di lokasi ini
    db.query('SELECT * FROM kegiatan_lokasi WHERE lokasi_id = ? AND aktif = 1 ORDER BY nama', [lokasiId], (err, kegiatanResults) => {
      if (err) return res.status(500).json({ error: err.message });
      
      // Ambil tanaman di lokasi ini
      db.query('SELECT id, nama, jenis, deskripsi, gambar FROM tanaman WHERE lokasi_id = ? ORDER BY nama', [lokasiId], (err, tanamanResults) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Ambil aktivitas di lokasi ini
        db.query('SELECT * FROM activity_schedules WHERE lokasi_id = ? ORDER BY tanggal_mulai DESC', [lokasiId], (err, aktivitasResults) => {
          if (err) return res.status(500).json({ error: err.message });
          
          res.json({
            ...lokasi,
            kegiatan: kegiatanResults,
            tanaman: tanamanResults,
            aktivitas: aktivitasResults
          });
        });
      });
    });
  });
});

// POST tambah lokasi
app.post('/api/lokasi', (req, res) => {
  const { nama, keterangan } = req.body;
  if (!nama) return res.status(400).json({ error: 'Nama lokasi diperlukan' });
  
  // Normalize nama: trim, remove extra spaces, case insensitive
  const namaNormalized = nama.trim().replace(/\s+/g, ' ');
  
  db.query('SELECT id FROM lokasi WHERE LOWER(nama) = LOWER(?)', [namaNormalized], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length > 0) return res.status(400).json({ error: 'Nama lokasi sudah ada' });
    
    db.query('INSERT INTO lokasi (nama, keterangan) VALUES (?, ?)', [namaNormalized, keterangan || null], (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: result.insertId, nama: namaNormalized, keterangan, aktif: 1 });
    });
  });
});

// PUT update lokasi
app.put('/api/lokasi/:id', (req, res) => {
  const { nama, keterangan } = req.body;
  if (!nama) return res.status(400).json({ error: 'Nama lokasi diperlukan' });
  
  const namaNormalized = nama.trim().replace(/\s+/g, ' ');
  
  db.query('SELECT id FROM lokasi WHERE LOWER(nama) = LOWER(?) AND id != ?', [namaNormalized, req.params.id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length > 0) return res.status(400).json({ error: 'Nama lokasi sudah ada' });
    
    db.query('UPDATE lokasi SET nama = ?, keterangan = ? WHERE id = ?', [namaNormalized, keterangan || null, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Lokasi diperbarui' });
    });
  });
});

// DELETE/hapus lokasi
app.delete('/api/lokasi/:id', (req, res) => {
  const lokasiId = req.params.id;
  
  // Cek apakah lokasi masih dipakai tanaman
  db.query('SELECT COUNT(*) as count FROM tanaman WHERE lokasi_id = ?', [lokasiId], (err, tanamanResults) => {
    if (err) return res.status(500).json({ error: err.message });
    if (tanamanResults[0].count > 0) {
      return res.status(400).json({ error: `Lokasi masih digunakan oleh ${tanamanResults[0].count} tanaman` });
    }
    
    // Cek apakah lokasi masih dipakai aktivitas
    db.query('SELECT COUNT(*) as count FROM activity_schedules WHERE lokasi_id = ?', [lokasiId], (err, aktivitasResults) => {
      if (err) return res.status(500).json({ error: err.message });
      if (aktivitasResults[0].count > 0) {
        return res.status(400).json({ error: `Lokasi masih digunakan oleh ${aktivitasResults[0].count} aktivitas` });
      }
      
      db.query('UPDATE lokasi SET aktif = 0 WHERE id = ?', [lokasiId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Lokasi dinonaktifkan' });
      });
    });
  });
});

// ── ENDPOINT KEGIATAN LOKASI ───────────────────────────────────────────────────
// GET kegiatan per lokasi
app.get('/api/kegiatan-lokasi', (req, res) => {
  const { lokasi_id } = req.query;
  let query = 'SELECT kl.*, l.nama as nama_lokasi FROM kegiatan_lokasi kl JOIN lokasi l ON kl.lokasi_id = l.id WHERE kl.aktif = 1';
  const params = [];
  
  if (lokasi_id) {
    query += ' AND kl.lokasi_id = ?';
    params.push(lokasi_id);
  }
  
  query += ' ORDER BY l.nama, kl.nama';
  
  db.query(query, params, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// POST tambah kegiatan lokasi
app.post('/api/kegiatan-lokasi', (req, res) => {
  const { lokasi_id, nama } = req.body;
  if (!lokasi_id || !nama) return res.status(400).json({ error: 'Lokasi ID dan nama kegiatan diperlukan' });
  
  const namaNormalized = nama.trim();
  
  // Cek apakah lokasi ada
  db.query('SELECT id FROM lokasi WHERE id = ? AND aktif = 1', [lokasi_id], (err, lokasiResults) => {
    if (err) return res.status(500).json({ error: err.message });
    if (lokasiResults.length === 0) return res.status(400).json({ error: 'Lokasi tidak ditemukan atau tidak aktif' });
    
    // Cek apakah kegiatan sudah ada di lokasi ini
    db.query('SELECT id FROM kegiatan_lokasi WHERE lokasi_id = ? AND LOWER(nama) = LOWER(?)', [lokasi_id, namaNormalized], (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (results.length > 0) return res.status(400).json({ error: 'Kegiatan dengan nama ini sudah ada di lokasi' });
      
      db.query('INSERT INTO kegiatan_lokasi (lokasi_id, nama) VALUES (?, ?)', [lokasi_id, namaNormalized], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: result.insertId, lokasi_id, nama: namaNormalized, aktif: 1 });
      });
    });
  });
});

// PUT update kegiatan lokasi
app.put('/api/kegiatan-lokasi/:id', (req, res) => {
  const { nama } = req.body;
  if (!nama) return res.status(400).json({ error: 'Nama kegiatan diperlukan' });
  
  const namaNormalized = nama.trim();
  
  // Ambil lokasi_id dari kegiatan yang akan diupdate
  db.query('SELECT lokasi_id FROM kegiatan_lokasi WHERE id = ?', [req.params.id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ error: 'Kegiatan tidak ditemukan' });
    
    const lokasi_id = results[0].lokasi_id;
    
    // Cek apakah nama sudah ada di lokasi ini (kecuali yang sedang diupdate)
    db.query('SELECT id FROM kegiatan_lokasi WHERE lokasi_id = ? AND LOWER(nama) = LOWER(?) AND id != ?', [lokasi_id, namaNormalized, req.params.id], (err, checkResults) => {
      if (err) return res.status(500).json({ error: err.message });
      if (checkResults.length > 0) return res.status(400).json({ error: 'Kegiatan dengan nama ini sudah ada di lokasi' });
      
      db.query('UPDATE kegiatan_lokasi SET nama = ? WHERE id = ?', [namaNormalized, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Kegiatan diperbarui' });
      });
    });
  });
});

// DELETE/hapus kegiatan lokasi
app.delete('/api/kegiatan-lokasi/:id', (req, res) => {
  db.query('UPDATE kegiatan_lokasi SET aktif = 0 WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Kegiatan dinonaktifkan' });
  });
});

// ── ENDPOINT SANTRI UNTUK PEMILIH ───────────────────────────────────────────────
// GET santri untuk pemilih (hanya status diterima)
app.get('/api/santri-pemilih', (req, res) => {
  const { kelas, kamar } = req.query;
  let query = 'SELECT id, nama, username, kelas, kamar FROM pendaftar_santri WHERE status_pendaftaran = "Diterima"';
  const params = [];
  
  if (kelas) {
    query += ' AND kelas = ?';
    params.push(kelas);
  }
  
  if (kamar) {
    query += ' AND kamar = ?';
    params.push(kamar);
  }
  
  query += ' ORDER BY nama';
  
  db.query(query, params, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// ── TRIGGER MANUAL CRON ───────────────────────────────────────────────────────
app.post('/api/jadwal/generate-tiket', (req, res) => {
  generateTiketHarian();
  res.json({ message: 'Generate tiket dijalankan untuk hari ini' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server Backend berjalan di http://localhost:${PORT}`));
