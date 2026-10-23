const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const sharp = require("sharp");

// Setup Multer & Sharp untuk Optimasi Gambar Otomatis (ke KB)
const multerStorage = multer.memoryStorage();
const multerUpload = multer({ storage: multerStorage });

const upload = {
  single: function (fieldName) {
    return async function (req, res, next) {
      multerUpload.single(fieldName)(req, res, async function (err) {
        if (err) return next(err);
        if (!req.file) return next();

        try {
          const dir = "./uploads";
          if (!fs.existsSync(dir)) fs.mkdirSync(dir);

          const filename =
            Date.now() + "-" + Math.round(Math.random() * 1e9) + ".webp";
          const filepath = path.join(dir, filename);

          // Kompresi ekstrim menggunakan Sharp ke format WebP
          await sharp(req.file.buffer)
            .resize({ width: 1080, withoutEnlargement: true }) // Maksimal lebar 1080px
            .webp({ quality: 75 }) // Kualitas 75% untuk menekan ukuran hingga puluhan/ratusan KB saja
            .toFile(filepath);

          // Update req.file agar route selanjutnya membaca file yang sudah disimpan
          req.file.filename = filename;
          req.file.path = filepath;
          req.file.mimetype = "image/webp";

          next();
        } catch (error) {
          console.error("Gagal mengkompresi gambar:", error);
          next(error);
        }
      });
    };
  },
};

// Hapus file gambar di ./uploads (dipakai saat ganti/hapus foto agar tidak ada file sisa)
const removeUpload = (filename) => {
  if (!filename) return;
  try {
    const filepath = path.join("./uploads", path.basename(filename));
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      console.log("🗑️ File gambar dihapus:", filepath);
    }
  } catch (error) {
    console.error("Gagal menghapus file gambar:", error.message);
  }
};

const JWT_SECRET = process.env.JWT_SECRET || "alfilaha_super_secret_key_2026";

// Upload disk langsung — untuk foto bukti tugas (tidak perlu Sharp compression)
const diskStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "./uploads";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  },
});
const uploadDisk = multer({
  storage: diskStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: function (req, file, cb) {
    const TIPE_IZIN = ["image/jpeg", "image/png", "image/webp"];
    if (TIPE_IZIN.includes(file.mimetype)) cb(null, true);
    else
      cb(
        new Error(
          "Hanya file gambar JPG/PNG/WebP yang berlaku untuk bukti tugas",
        ),
      );
  },
});

const app = express();

// Penanda versi build — dipanggil lewat /api/test supaya gampang memastikan
// proses backend yang jalan sudah memakai kode terbaru (bukan versi lama di memori).
const BUILD_ID = new Date().toISOString();

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "https://alfilaha.id",
  "http://192.168.1.32:5173",
]; // Tambahkan domain frontend Anda di sini

// Middleware
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Origin", "Accept"],
  }),
);

// Handle preflight PATCH
app.options("{*path}", cors());

app.use(express.json());
app.use("/uploads", express.static("uploads")); // Serve uploaded images

// Konfigurasi Koneksi Database (pool agar tahan disconnect & auto-reconnect)
const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "db_alfilaha",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

// Tangani error koneksi agar "Connection was killed" (code 1927) tidak
// mematikan proses secara fatal.
db.on("error", (err) => {
  console.error("❌ [Database] Koneksi bermasalah:", err.code || err.message);
});

// Cek Koneksi ke MySQL
db.getConnection((err, connection) => {
  if (err) {
    console.error("❌ Gagal koneksi ke database:", err);
    return;
  }
  connection.release();
  console.log("✅ Berhasil terhubung ke MySQL (db_alfilaha)");

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
          const seedQuery =
            "INSERT INTO paket_wisata (nama_paket, harga, deskripsi) VALUES ?";
          const seedValues = [
            [
              "Edukasi Basic",
              "Rp 50.000 / orang",
              "Fasilitas: Keliling kebun, panen sayur 1 macam, air mineral.",
            ],
            [
              "Edukasi Premium",
              "Rp 100.000 / orang",
              "Fasilitas: Keliling kebun, panen sayur 3 macam, snack, sertifikat.",
            ],
            [
              "Paket Wisata Keluarga",
              "Rp 150.000 / keluarga",
              "Fasilitas: Gazebo private, alat BBQ, panen buah sepuasnya.",
            ],
          ];
          db.query(seedQuery, [seedValues], (err) => {
            if (!err)
              console.log("✅ Data awal paket wisata berhasil dimasukkan.");
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
          const seedQuery =
            "INSERT INTO events (title, category, date, description, image) VALUES ?";
          const seedValues = [
            [
              "Pelatihan Pertanian Organik",
              "Kegiatan",
              "15 Agu 2026",
              "Woshop intensif tentang teknik pertanian organik dan sustainable farming untuk santri dan masyarakat umum.",
              null,
            ],
            [
              "Family Day: Berkebun Bersama",
              "Event",
              "22 Agu 2026",
              "Ajak keluarga untuk belajar berkebun dan menanam bersama di kebun Alfilaha. Aktivitas seru dan edukatif!",
              null,
            ],
            [
              "Komposting dan Pengelolaan Sampah",
              "Workshop",
              "29 Agu 2026",
              "Belajar cara mengolah sampah organik menjadi kompos berkualitas untuk kesuburan tanah.",
              null,
            ],
          ];
          db.query(seedQuery, [seedValues], (err) => {
            if (!err) console.log("✅ Data awal events berhasil dimasukkan.");
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
          const seedQuery =
            "INSERT INTO blogs (title, date, excerpt, content, image) VALUES ?";
          const seedValues = [
            [
              "Menjaga Kualitas Beras Organik",
              "12 Okt 2023",
              "Beras organik bebas dari pestisida buatan dan pupuk sintetis, sehingga lebih aman bagi...",
              "<p>Beras organik bebas dari pestisida buatan dan pupuk sintetis, sehingga lebih aman bagi kesehatan tubuh kita.</p>",
              null,
            ],
            [
              "Promo Spesial Ramadhan 1445H",
              "15 Okt 2023",
              "Menyambut bulan suci Ramadhan, Alfilaha memberikan promo khusus untuk semua jenis...",
              "<p>Menyambut bulan suci Ramadhan, Alfilaha memberikan promo khusus untuk semua jenis produk beras.</p>",
              null,
            ],
          ];
          db.query(seedQuery, [seedValues], (err) => {
            if (!err) console.log("✅ Data awal blogs berhasil dimasukkan.");
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
      db.query(
        "SELECT COUNT(*) AS count FROM admin_users",
        async (err, results) => {
          if (!err && results[0].count === 0) {
            const hashedPassword = await bcrypt.hash("admin123", 10);
            db.query(
              "INSERT INTO admin_users (username, password) VALUES (?, ?)",
              ["admin", hashedPassword],
              (err) => {
                if (!err)
                  console.log(
                    "✅ Akun admin default berhasil dibuat (admin / admin123).",
                  );
              },
            );
          }
        },
      );
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
      // Migrasi kolom baru jika belum ada. Memakai SHOW COLUMNS per kolom
      // karena MySQL/MariaDB tidak mendukung "ADD COLUMN IF NOT EXISTS"
      // berulang dalam satu ALTER TABLE.
      const kolomTanaman = [
        ["usia", "VARCHAR(100)"],
        ["jadwal_siram", "VARCHAR(100)"],
        ["jadwal_pupuk", "VARCHAR(100)"],
        ["jadwal_panen", "VARCHAR(100)"],
        ["penanggung_jawab", "VARCHAR(255)"],
        ["kebutuhan_air", "VARCHAR(100)"],
        ["terakhir_dipupuk", "VARCHAR(100)"],
      ];
      kolomTanaman.forEach(([kolom, definisi]) => {
        db.query(
          `SHOW COLUMNS FROM tanaman LIKE '${kolom}'`,
          (eCek, rowsCek) => {
            if (eCek || (rowsCek && rowsCek.length > 0)) return;
            db.query(
              `ALTER TABLE tanaman ADD COLUMN ${kolom} ${definisi}`,
              (eTambah) => {
                if (eTambah)
                  console.log(
                    `Info tambah kolom tanaman '${kolom}':`,
                    eTambah.message,
                  );
                else console.log(`✅ Kolom tanaman '${kolom}' ditambahkan.`);
              },
            );
          },
        );
      });
      // Samakan panjang penanggung_jawab dengan definisi CREATE TABLE (VARCHAR(255)).
      db.query(
        "ALTER TABLE tanaman MODIFY COLUMN penanggung_jawab VARCHAR(255)",
        (e) => {
          if (e)
            console.log("Info update panjang penanggung_jawab: ", e.message);
        },
      );
      // Index komposit untuk mempercepat riwayat per tanaman (WHERE + ORDER BY).
      db.query(
        "SHOW INDEX FROM log_perawatan WHERE Key_name='idx_log_tanaman_waktu'",
        (eIdx, rIdx) => {
          if (eIdx || (rIdx && rIdx.length > 0)) return;
          db.query(
            "ALTER TABLE log_perawatan ADD INDEX idx_log_tanaman_waktu (tanaman_id, waktu_tindakan)",
            (eAdd) => {
              if (eAdd)
                console.log("Info index riwayat tanaman:", eAdd.message);
              else console.log("✅ Index idx_log_tanaman_waktu ditambahkan.");
            },
          );
        },
      );
    }
  });

  const createLogPerawatanQuery = `
    CREATE TABLE IF NOT EXISTS log_perawatan (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tanaman_id INT NOT NULL,
      santri_id INT NULL,
      jenis_tindakan ENUM('siram', 'pupuk', 'panen') NOT NULL,
      nama_perawat VARCHAR(255),
      role_perawat VARCHAR(50),
      gambar VARCHAR(255),
      laporan_singkat TEXT,
      jadwal_id INT NULL DEFAULT NULL,
      waktu_tindakan TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tanaman_id) REFERENCES tanaman(id) ON DELETE CASCADE,
      FOREIGN KEY (santri_id) REFERENCES pendaftar_santri(id) ON DELETE SET NULL
    )
  `;
  db.query(createLogPerawatanQuery, (err) => {
    if (err) console.error("❌ Gagal membuat tabel log_perawatan:", err);
    else {
      console.log("✅ Tabel 'log_perawatan' siap digunakan.");

      // Tambahkan kolom yang hilang jika belum ada
      db.query(
        "SHOW COLUMNS FROM log_perawatan LIKE 'nama_perawat'",
        (err1, rows1) => {
          if (!err1 && (!rows1 || rows1.length === 0)) {
            db.query(
              "ALTER TABLE log_perawatan ADD COLUMN nama_perawat VARCHAR(255)",
              (err2) => {
                if (err2)
                  console.log("Info tambah nama_perawat: ", err2.message);
                else console.log("✅ Kolom nama_perawat ditambahkan.");
              },
            );
          }
        },
      );

      db.query(
        "SHOW COLUMNS FROM log_perawatan LIKE 'role_perawat'",
        (err3, rows3) => {
          if (!err3 && (!rows3 || rows3.length === 0)) {
            db.query(
              "ALTER TABLE log_perawatan ADD COLUMN role_perawat VARCHAR(50)",
              (err4) => {
                if (err4)
                  console.log("Info tambah role_perawat: ", err4.message);
                else console.log("✅ Kolom role_perawat ditambahkan.");
              },
            );
          }
        },
      );

      // Pastikan santri_id nullable
      db.query(
        "SHOW COLUMNS FROM log_perawatan LIKE 'santri_id'",
        (err5, rows5) => {
          if (!err5 && rows5 && rows5.length > 0 && rows5[0].Null === "NO") {
            db.query(
              "ALTER TABLE log_perawatan MODIFY santri_id INT NULL",
              (err6) => {
                if (err6)
                  console.log("Info ubah santri_id nullable: ", err6.message);
                else console.log("✅ Kolom '_santri_id' dibuat nullable.");
              },
            );
          }
        },
      );

      // Bukti kerja (foto + laporan singkat + asal jadwal) — dipakai oleh
      // POST /api/tugas/:id/selesai dan ditampilkan di halaman detail tanaman.
      const kolomLogPerawatan = [
        ["gambar", "VARCHAR(255) NULL AFTER nama_perawat"],
        ["laporan_singkat", "TEXT NULL AFTER gambar"],
        ["jadwal_id", "INT NULL DEFAULT NULL"],
      ];
      kolomLogPerawatan.forEach(([kolom, definisi]) => {
        db.query(
          `SHOW COLUMNS FROM log_perawatan LIKE '${kolom}'`,
          (errCek, rowsCek) => {
            if (errCek || (rowsCek && rowsCek.length > 0)) return;
            db.query(
              `ALTER TABLE log_perawatan ADD COLUMN ${kolom} ${definisi}`,
              (errTambah) => {
                if (errTambah)
                  console.log(`Info tambah ${kolom}: `, errTambah.message);
                else console.log(`✅ Kolom ${kolom} ditambahkan.`);
              },
            );
          },
        );
      });

      // Hapus tabel riwayat_perawatan yang bermasalah jika ada
      db.query("SHOW TABLES LIKE 'riwayat_perawatan'", (err7, rows7) => {
        if (!err7 && rows7 && rows7.length > 0) {
          console.log("⚠️ Tabel riwayat_perawatan ditemukan, menghapus...");
          db.query(
            "ALTER TABLE riwayat_perawatan DROP FOREIGN KEY IF EXISTS riwayat_perawatan_ibfk_1",
            (err8) => {
              console.log(
                "Info drop riwayat_perawatan_ibfk_1:",
                err8 ? err8.message : "✅",
              );
            },
          );
          db.query(
            "ALTER TABLE riwayat_perawatan DROP FOREIGN KEY IF EXISTS riwayat_perawatan_ibfk_2",
            (err9) => {
              console.log(
                "Info drop riwayat_perawatan_ibfk_2:",
                err9 ? err9.message : "✅",
              );
            },
          );
          setTimeout(() => {
            db.query("DROP TABLE IF EXISTS riwayat_perawatan", (err10) => {
              if (err10)
                console.log("Info drop riwayat_perawatan:", err10.message);
              else console.log("✅ Tabel riwayat_perawatan berhasil dihapus.");
            });
          }, 1000);
        }
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
app.get("/api/test", (req, res) => {
  res.json({
    message: "Halo! Backend Node.js berhasil berjalan dan terhubung ke DB.",
    build: BUILD_ID,
  });
});

// ==========================================
// API PENDAFTARAN SANTRI (PUBLIC & AUTO-LOGIN)
// ==========================================

// 1. Submit Pendaftaran
app.post("/api/pendaftaran", async (req, res) => {
  const {
    nama,
    tempat_lahir,
    tanggal_lahir,
    jenis_kelamin,
    alamat,
    no_wa,
    email,
    username,
    password,
  } = req.body;

  try {
    db.query(
      "SELECT * FROM pendaftar_santri WHERE username = ?",
      [username],
      async (err, results) => {
        if (err)
          return res
            .status(500)
            .json({ message: "Terjadi kesalahan server saat cek username." });

        if (results.length > 0) {
          return res
            .status(400)
            .json({
              message: "Username sudah digunakan, silakan pilih yang lain.",
            });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const sql = `INSERT INTO pendaftar_santri (nama, tempat_lahir, tanggal_lahir, jenis_kelamin, alamat, no_wa, email, username, password) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const values = [
          nama,
          tempat_lahir,
          tanggal_lahir,
          jenis_kelamin,
          alamat,
          no_wa,
          email,
          username,
          hashedPassword,
        ];

        db.query(sql, values, (err, insertResult) => {
          if (err)
            return res
              .status(500)
              .json({
                message: "Gagal menyimpan data ke database.",
                error: err.message,
              });

          const token = jwt.sign(
            { id: insertResult.insertId, username },
            JWT_SECRET,
            { expiresIn: "30d" },
          );
          res.status(201).json({ message: "Pendaftaran Berhasil", token });
        });
      },
    );
  } catch (err) {
    res.status(500).json({ message: "Terjadi kesalahan server." });
  }
});

// Middleware untuk mengecek token santri/petani
const authenticateSantriToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token)
    return res.status(401).json({ message: "Akses ditolak. Belum login." });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err)
      return res
        .status(403)
        .json({ message: "Token tidak valid atau sudah kadaluarsa." });
    req.user = user;
    next();
  });
};

// 1.5 Login Santri
app.post("/api/pendaftaran/login", (req, res) => {
  const { username, password } = req.body;

  db.query(
    "SELECT * FROM pendaftar_santri WHERE username = ?",
    [username],
    async (err, results) => {
      if (err)
        return res
          .status(500)
          .json({ message: "Terjadi kesalahan server saat login." });

      if (results.length === 0) {
        return res.status(401).json({ message: "Username tidak ditemukan." });
      }

      const user = results[0];
      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        return res.status(401).json({ message: "Password salah." });
      }

      const token = jwt.sign(
        { id: user.id, username: user.username, role: "Santri" },
        JWT_SECRET,
        { expiresIn: "30d" },
      );

      // Return user data without password
      const { password: _, ...userWithoutPassword } = user;

      res.json({
        message: "Login berhasil",
        token,
        user: userWithoutPassword,
      });
    },
  );
});

// 2. Cek Status Pendaftaran (Auto-Login)
app.get("/api/pendaftaran/status", authenticateSantriToken, (req, res) => {
  const sql =
    "SELECT id, nama, tempat_lahir, DATE_FORMAT(tanggal_lahir, '%Y-%m-%d') as tanggal_lahir, jenis_kelamin, alamat, no_wa, email, username, status_pendaftaran FROM pendaftar_santri WHERE id = ?";

  db.query(sql, [req.user.id], (err, results) => {
    if (err)
      return res
        .status(500)
        .json({ message: "Terjadi kesalahan saat mengambil status." });

    if (results.length === 0) {
      return res.status(404).json({ message: "Data tidak ditemukan." });
    }

    res.json(results[0]);
  });
});

// ==========================================
// API MANAJEMEN PENDAFTAR (ADMIN)
// ==========================================

app.get("/api/pendaftar_santri", (req, res) => {
  db.query(
    "SELECT * FROM pendaftar_santri ORDER BY id DESC",
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    },
  );
});

app.put("/api/pendaftar_santri/:id/status", (req, res) => {
  const { status } = req.body;
  const query =
    "UPDATE pendaftar_santri SET status_pendaftaran = ? WHERE id = ?";

  db.query(query, [status, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: `Status santri diperbarui menjadi ${status}` });
  });
});

app.delete("/api/pendaftar_santri/:id", (req, res) => {
  db.query(
    "DELETE FROM pendaftar_santri WHERE id = ?",
    [req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Data santri berhasil dihapus" });
    },
  );
});

// ==========================================
// API PROGRAMS (PROGRAM PENDAFTARAN)
// ==========================================

app.get("/api/programs", (req, res) => {
  db.query(
    "SELECT * FROM program_pendaftaran ORDER BY id DESC",
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    },
  );
});

app.post("/api/programs", upload.single("poster"), (req, res) => {
  const { judul, jenis, nama, status, batas_akhir, keterangan } = req.body;
  const poster = req.file ? req.file.filename : null;

  const query =
    "INSERT INTO program_pendaftaran (judul, jenis, nama, status, batas_akhir, keterangan, poster) VALUES (?, ?, ?, ?, ?, ?, ?)";
  db.query(
    query,
    [judul, jenis, nama, status, batas_akhir, keterangan, poster],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        message: "Program berhasil ditambahkan",
        id: results.insertId,
      });
    },
  );
});

app.put("/api/programs/:id", upload.single("poster"), (req, res) => {
  const { judul, jenis, nama, status, batas_akhir, keterangan } = req.body;

  if (req.file) {
    const poster = req.file.filename;
    const query =
      "UPDATE program_pendaftaran SET judul=?, jenis=?, nama=?, status=?, batas_akhir=?, keterangan=?, poster=? WHERE id=?";
    db.query(
      query,
      [
        judul,
        jenis,
        nama,
        status,
        batas_akhir,
        keterangan,
        poster,
        req.params.id,
      ],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Program beserta poster berhasil diperbarui" });
      },
    );
  } else {
    const query =
      "UPDATE program_pendaftaran SET judul=?, jenis=?, nama=?, status=?, batas_akhir=?, keterangan=? WHERE id=?";
    db.query(
      query,
      [judul, jenis, nama, status, batas_akhir, keterangan, req.params.id],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Program berhasil diperbarui" });
      },
    );
  }
});

app.put("/api/programs/:id/status", (req, res) => {
  const { status } = req.body;
  const query = "UPDATE program_pendaftaran SET status = ? WHERE id = ?";

  db.query(query, [status, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: `Status program diperbarui menjadi ${status}` });
  });
});

app.delete("/api/programs/:id", (req, res) => {
  db.query(
    "DELETE FROM program_pendaftaran WHERE id = ?",
    [req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Program berhasil dihapus" });
    },
  );
});

// ==========================================
// API GALERI
// ==========================================

const GALERI_CATEGORIES = [
  "Lahan Pertanian",
  "Kegiatan Santri",
  "Edukasi",
  "Panen",
  "Camping",
  "Kegiatan Masyarakat",
];

app.get("/api/galeri", (req, res) => {
  db.query("SELECT * FROM galeri ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.post("/api/galeri", upload.single("image"), (req, res) => {
  const { title, description, category } = req.body || {};
  const image_url = req.file ? req.file.filename : null;

  if (!image_url)
    return res.status(400).json({ error: "Gambar wajib diunggah" });
  if (!title || !String(title).trim())
    return res.status(400).json({ error: "Judul wajib diisi" });
  if (!category || !String(category).trim())
    return res.status(400).json({ error: "Kategori wajib diisi" });
  if (!GALERI_CATEGORIES.includes(category))
    return res.status(400).json({ error: "Kategori tidak valid" });

  const query =
    "INSERT INTO galeri (title, description, category, image_url) VALUES (?, ?, ?, ?)";
  db.query(
    query,
    [String(title).trim(), description || null, category, image_url],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res
        .status(201)
        .json({ message: "Foto berhasil ditambahkan", id: results.insertId });
    },
  );
});

// Ubah Foto Galeri (gambar opsional — bila tidak dikirim, gambar lama dipertahankan)
app.put("/api/galeri/:id", upload.single("image"), (req, res) => {
  const { title, description, category } = req.body || {};

  if (!title || !String(title).trim())
    return res.status(400).json({ error: "Judul wajib diisi" });
  if (!category || !String(category).trim())
    return res.status(400).json({ error: "Kategori wajib diisi" });
  if (!GALERI_CATEGORIES.includes(category))
    return res.status(400).json({ error: "Kategori tidak valid" });

  db.query(
    "SELECT image_url FROM galeri WHERE id = ?",
    [req.params.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: "Foto tidak ditemukan" });
      }

      const oldImage = rows[0].image_url;
      const newImage = req.file ? req.file.filename : null;
      // Hanya sentuh kolom description bila memang dikirim, supaya deskripsi lama tidak ikut terhapus
      const hasDescription = Object.prototype.hasOwnProperty.call(
        req.body,
        "description",
      );
      const descValue = hasDescription ? description || null : undefined;

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
          [String(title).trim(), descValue, category, req.params.id],
          (err) => finish(err, oldImage),
        );
      } else {
        db.query(
          "UPDATE galeri SET title = ?, category = ? WHERE id = ?",
          [String(title).trim(), category, req.params.id],
          (err) => finish(err, oldImage),
        );
      }
    },
  );
});

app.delete("/api/galeri/:id", (req, res) => {
  db.query(
    "SELECT image_url FROM galeri WHERE id = ?",
    [req.params.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows || rows.length === 0) {
        return res
          .status(404)
          .json({ error: "Foto tidak ditemukan, mungkin sudah dihapus" });
      }

      const imageUrl = rows[0].image_url;
      db.query("DELETE FROM galeri WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        removeUpload(imageUrl);
        res.json({ message: "Foto berhasil dihapus" });
      });
    },
  );
});

// ==========================================
// API RESERVASI
// ==========================================

// Ambil Semua Reservasi (Untuk Dashboard Admin)
app.get("/api/reservasi", (req, res) => {
  db.query("SELECT * FROM reservasi ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// Buat Reservasi Baru (Dari Form Website Utama)
app.post("/api/reservasi", (req, res) => {
  const { nama, whatsapp, email, instansi, tanggal, jumlah, pesan } = req.body;
  const query =
    "INSERT INTO reservasi (nama, whatsapp, email, instansi, tanggal, jumlah, pesan) VALUES (?, ?, ?, ?, ?, ?, ?)";

  db.query(
    query,
    [nama, whatsapp, email, instansi, tanggal, jumlah, pesan],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        message: "Reservasi berhasil dikirim!",
        id: results.insertId,
      });
    },
  );
});

// Ubah Status Reservasi (Terima / Tolak dari Admin)
app.put("/api/reservasi/:id/status", (req, res) => {
  const { status } = req.body;
  const query = "UPDATE reservasi SET status = ? WHERE id = ?";

  db.query(query, [status, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: `Status reservasi diperbarui menjadi ${status}` });
  });
});

// Hapus Reservasi (Dari Admin Dashboard)
app.delete("/api/reservasi/:id", (req, res) => {
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
app.get("/api/paket", (req, res) => {
  db.query("SELECT * FROM paket_wisata", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// Update Paket (Harga, Nama, Deskripsi)
app.put("/api/paket/:id", (req, res) => {
  const { nama_paket, harga, deskripsi } = req.body;
  const query =
    "UPDATE paket_wisata SET nama_paket = ?, harga = ?, deskripsi = ? WHERE id = ?";

  db.query(query, [nama_paket, harga, deskripsi, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Data paket wisata berhasil diperbarui" });
  });
});

// Tambah Paket Baru
app.post("/api/paket", (req, res) => {
  const { nama_paket, harga, deskripsi } = req.body;
  const query =
    "INSERT INTO paket_wisata (nama_paket, harga, deskripsi) VALUES (?, ?, ?)";

  db.query(query, [nama_paket, harga, deskripsi], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({
      message: "Paket wisata berhasil ditambahkan",
      id: results.insertId,
    });
  });
});

// Hapus Paket
app.delete("/api/paket/:id", (req, res) => {
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
app.get("/api/events", (req, res) => {
  db.query("SELECT * FROM events ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// Tambah Event Baru (dengan upload gambar)
app.post("/api/events", upload.single("image"), (req, res) => {
  const { title, category, date, description } = req.body;
  const image = req.file ? req.file.filename : null;

  const query =
    "INSERT INTO events (title, category, date, description, image) VALUES (?, ?, ?, ?, ?)";
  db.query(
    query,
    [title, category, date, description, image],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Event berhasil ditambahkan", id: results.insertId });
    },
  );
});

// Update Event (termasuk optional ganti gambar)
app.put("/api/events/:id", upload.single("image"), (req, res) => {
  const { title, category, date, description } = req.body;

  if (req.file) {
    const image = req.file.filename;
    const query =
      "UPDATE events SET title=?, category=?, date=?, description=?, image=? WHERE id=?";
    db.query(
      query,
      [title, category, date, description, image, req.params.id],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Event beserta gambar berhasil diperbarui" });
      },
    );
  } else {
    const query =
      "UPDATE events SET title=?, category=?, date=?, description=? WHERE id=?";
    db.query(
      query,
      [title, category, date, description, req.params.id],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Event berhasil diperbarui" });
      },
    );
  }
});

// Hapus Event
app.delete("/api/events/:id", (req, res) => {
  db.query("DELETE FROM events WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Event berhasil dihapus" });
  });
});

// ==========================================
// API BLOG GRID
// ==========================================

// Ambil Semua Blog
app.get("/api/blogs", (req, res) => {
  db.query("SELECT * FROM blogs ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// Tambah Blog Baru
app.post("/api/blogs", upload.single("image"), (req, res) => {
  const { title, date, excerpt, content } = req.body;
  const image = req.file ? req.file.filename : null;

  const query =
    "INSERT INTO blogs (title, date, excerpt, content, image) VALUES (?, ?, ?, ?, ?)";
  db.query(query, [title, date, excerpt, content, image], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Blog berhasil ditambahkan", id: results.insertId });
  });
});

// Update Blog
app.put("/api/blogs/:id", upload.single("image"), (req, res) => {
  const { title, date, excerpt, content } = req.body;

  if (req.file) {
    const image = req.file.filename;
    const query =
      "UPDATE blogs SET title=?, date=?, excerpt=?, content=?, image=? WHERE id=?";
    db.query(
      query,
      [title, date, excerpt, content, image, req.params.id],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Blog beserta gambar berhasil diperbarui" });
      },
    );
  } else {
    const query =
      "UPDATE blogs SET title=?, date=?, excerpt=?, content=? WHERE id=?";
    db.query(query, [title, date, excerpt, content, req.params.id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Blog berhasil diperbarui" });
    });
  }
});

// Hapus Blog
app.delete("/api/blogs/:id", (req, res) => {
  db.query("DELETE FROM blogs WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Blog berhasil dihapus" });
  });
});

// ==========================================
// API LAYANAN
// ==========================================

// Ambil Semua Layanan
app.get("/api/layanan", (req, res) => {
  db.query("SELECT * FROM layanan ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// Ambil Satu Layanan berdasarkan ID
app.get("/api/layanan/:id", (req, res) => {
  db.query(
    "SELECT * FROM layanan WHERE id = ?",
    [req.params.id],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (results.length === 0)
        return res.status(404).json({ error: "Layanan tidak ditemukan" });
      res.json(results[0]);
    },
  );
});

// Tambah Layanan Baru
app.post("/api/layanan", upload.single("image"), (req, res) => {
  const { title, description } = req.body;
  const image = req.file ? req.file.filename : null;
  db.query(
    "INSERT INTO layanan (title, description, image) VALUES (?, ?, ?)",
    [title, description, image],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        message: "Layanan berhasil ditambahkan",
        id: results.insertId,
      });
    },
  );
});

// Update Layanan
app.put("/api/layanan/:id", upload.single("image"), (req, res) => {
  const { title, description } = req.body;
  if (req.file) {
    db.query(
      "UPDATE layanan SET title=?, description=?, image=? WHERE id=?",
      [title, description, req.file.filename, req.params.id],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Layanan berhasil diperbarui" });
      },
    );
  } else {
    db.query(
      "UPDATE layanan SET title=?, description=? WHERE id=?",
      [title, description, req.params.id],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Layanan berhasil diperbarui" });
      },
    );
  }
});

// Hapus Layanan
app.delete("/api/layanan/:id", (req, res) => {
  db.query("DELETE FROM layanan WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Layanan berhasil dihapus" });
  });
});

// ==========================================
// API APPOINTMENTS
// ==========================================

// Ambil Semua Appointments (Untuk Dashboard Admin)
app.get("/api/appointments", (req, res) => {
  db.query("SELECT * FROM appointments ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// Buat Appointment Baru (Dari Form Website Utama)
app.post("/api/appointments", (req, res) => {
  const { name, number, email, address, message } = req.body;
  const query =
    "INSERT INTO appointments (name, number, email, address, message) VALUES (?, ?, ?, ?, ?)";

  db.query(query, [name, number, email, address, message], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({
      message: "Appointment berhasil dikirim!",
      id: results.insertId,
    });
  });
});

// Ubah Status Appointment (Terima / Tolak dari Admin)
app.put("/api/appointments/:id/status", (req, res) => {
  const { status } = req.body;
  const query = "UPDATE appointments SET status = ? WHERE id = ?";

  db.query(query, [status, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: `Status appointment diperbarui menjadi ${status}` });
  });
});

// Hapus Appointment (Dari Admin Dashboard)
app.delete("/api/appointments/:id", (req, res) => {
  const query = "DELETE FROM appointments WHERE id = ?";

  db.query(query, [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Data appointment berhasil dihapus dari MySQL" });
  });
});

// ==========================================
// API AUTENTIKASI
// ==========================================
app.post("/api/register", async (req, res) => {
  const { nama_lengkap, username, password, role } = req.body;
  if (!nama_lengkap || !username || !password || !role) {
    return res.status(400).json({ message: "Semua field harus diisi!" });
  }

  try {
    db.query(
      "SELECT * FROM users WHERE username = ?",
      [username],
      async (err, results) => {
        if (err)
          return res
            .status(500)
            .json({ message: "Terjadi kesalahan server saat cek username." });

        if (results.length > 0) {
          return res.status(400).json({ message: "Username sudah digunakan." });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const sql =
          "INSERT INTO users (nama_lengkap, username, password, role, status) VALUES (?, ?, ?, ?, 'pending')";
        db.query(
          sql,
          [nama_lengkap, username, hashedPassword, role],
          (err, insertResult) => {
            if (err)
              return res
                .status(500)
                .json({ message: "Gagal register", error: err.message });
            res
              .status(201)
              .json({
                message: "Registrasi Berhasil. Menunggu persetujuan Admin.",
              });
          },
        );
      },
    );
  } catch (err) {
    res.status(500).json({ message: "Terjadi kesalahan server." });
  }
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  // Coba cek di tabel users
  db.query(
    "SELECT * FROM users WHERE username = ?",
    [username],
    async (err, results) => {
      if (err) return res.status(500).json({ error: err.message });

      if (results.length > 0) {
        const user = results[0];

        if (user.status !== "approved") {
          return res
            .status(403)
            .json({
              error:
                "Akun Anda belum disetujui oleh Admin. Harap tunggu konfirmasi.",
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: "Password salah!" });

        const token = jwt.sign(
          { id: user.id, username: user.username, role: user.role },
          JWT_SECRET,
          { expiresIn: "1d" },
        );
        return res.json({
          message: "Login berhasil",
          token,
          user: {
            id: user.id,
            nama_lengkap: user.nama_lengkap,
            role: user.role,
          },
        });
      }

      // Jika tidak ada di users, cek di admin_users
      db.query(
        "SELECT * FROM admin_users WHERE username = ?",
        [username],
        async (errAdmin, resultsAdmin) => {
          if (errAdmin)
            return res.status(500).json({ error: errAdmin.message });

          if (resultsAdmin.length === 0) {
            return res.status(401).json({ error: "Username tidak ditemukan!" });
          }

          const admin = resultsAdmin[0];
          const isMatch = await bcrypt.compare(password, admin.password);

          if (!isMatch) {
            return res.status(401).json({ error: "Password salah!" });
          }

          const token = jwt.sign(
            {
              id: admin.id,
              username: admin.username,
              role: "admin",
              kind: "admin",
            },
            JWT_SECRET,
            { expiresIn: "1d" },
          );
          res.json({
            message: "Login admin berhasil",
            token,
            user: {
              id: admin.id,
              nama_lengkap: "Administrator",
              role: "admin",
            },
          });
        },
      );
    },
  );
});

// Auth Middleware
const authenticateUserToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token)
    return res.status(401).json({ message: "Akses ditolak. Belum login." });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err)
      return res
        .status(403)
        .json({ message: "Token tidak valid atau sudah kadaluarsa." });
    req.user = user;
    next();
  });
};

// ==========================================
// API ADMIN - MANAJEMEN USER (APPROVAL)
// ==========================================
app.get("/api/admin/users", (req, res) => {
  db.query(
    "SELECT id, nama_lengkap, username, role, status, created_at FROM users ORDER BY created_at DESC",
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    },
  );
});

app.put("/api/admin/users/:id/approve", (req, res) => {
  db.query(
    "UPDATE users SET status = 'approved' WHERE id = ?",
    [req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "User berhasil disetujui" });
    },
  );
});

app.delete("/api/admin/users/:id/reject", (req, res) => {
  db.query("DELETE FROM users WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "User berhasil ditolak & dihapus" });
  });
});

// Endpoint untuk upload gambar sisipan dari React Quill
app.post("/api/upload", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Gagal mengupload gambar" });
  }
  // Kembalikan URL gambar agar bisa dirender oleh React Quill
  // Jika app berjalan di production (misal alfilaha.id), URL ini idealnya dinamis
  const protocol = req.protocol;
  const host = req.get("host");
  const imageUrl = `${protocol}://${host}/uploads/${req.file.filename}`;
  res.json({ url: imageUrl });
});

// ==========================================
// API TANAMAN
// ==========================================
app.get("/api/tanaman", (req, res) => {
  db.query("SELECT * FROM tanaman ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// Aksi perawatan global (siram/pupuk/panen). Terdaftar SEBELUM route /:id supaya
// GET /api/tanaman/:id/aksi tidak tertimpa/ter-shadow oleh route lain.
const AKSI_PERAWATAN = ["siram", "pupuk", "panen"];
app.get("/api/tanaman/:id/aksi", (req, res) => {
  const tanamanId = parseInt(req.params.id);
  if (Number.isNaN(tanamanId)) {
    return res.status(400).json({ error: "ID tanaman tidak valid." });
  }
  db.query("SELECT id FROM tanaman WHERE id = ?", [tanamanId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!rows.length)
      return res.status(404).json({ message: "Tanaman tidak ditemukan" });
    db.query(
      "SELECT id, nama_aksi, urutan, aktif FROM master_aksi_tanaman WHERE tanaman_id = ? ORDER BY urutan ASC, id ASC",
      [tanamanId],
      (err2, aksRows) => {
        if (err2) {
          return res.status(500).json({ error: err2.message });
        }
        if (aksRows.length > 0) {
          const aksi_detail = aksRows.map((a) => ({
            id: a.id || null,
            nama_aksi: String(a.nama_aksi || "")
              .trim()
              .toLowerCase(),
            urutan: Number(a.urutan) || 0,
            aktif: Number(a.aktif) === 1 ? 1 : 0,
          }));
          const aksi = aksi_detail
            .filter((a) => a.aktif === 1)
            .map((a) => a.nama_aksi)
            .filter(Boolean);
          return res.json({
            aksi: aksi.length ? aksi : AKSI_PERAWATAN,
            aksi_detail,
          });
        }
        const def = AKSI_PERAWATAN.map((a) => a);
        return res.json({ aksi: def });
      },
    );
  });
});

app.get("/api/tanaman/:id", (req, res) => {
  db.query(
    "SELECT * FROM tanaman WHERE id = ?",
    [req.params.id],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (results.length === 0)
        return res.status(404).json({ message: "Not found" });
      res.json(results[0]);
    },
  );
});

app.post("/api/tanaman", upload.single("gambar"), (req, res) => {
  const {
    nama,
    jenis,
    lokasi,
    lokasi_id,
    deskripsi,
    kondisi,
    usia,
    jadwal_siram,
    jadwal_pupuk,
    jadwal_panen,
    penanggung_jawab,
    kebutuhan_air,
    terakhir_dipupuk,
  } = req.body;
  const gambar = req.file ? req.file.filename : null;

  const insertTanaman = (lokasiNama, idLokasi) => {
    db.query(
      "INSERT INTO tanaman (nama, jenis, lokasi, lokasi_id, deskripsi, kondisi, gambar, usia, jadwal_siram, jadwal_pupuk, jadwal_panen, penanggung_jawab, kebutuhan_air, terakhir_dipupuk) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        nama,
        jenis,
        lokasiNama,
        idLokasi,
        deskripsi,
        kondisi || "Sehat",
        gambar,
        usia,
        jadwal_siram,
        jadwal_pupuk,
        jadwal_panen,
        penanggung_jawab,
        kebutuhan_air,
        terakhir_dipupuk,
      ],
      (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Berhasil", id: results.insertId });
      },
    );
  };

  if (lokasi_id) {
    db.query(
      "SELECT nama FROM lokasi WHERE id = ? AND aktif = 1",
      [lokasi_id],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        insertTanaman(
          (rows.length ? rows[0].nama : null) || lokasi,
          lokasi_id || null,
        );
      },
    );
  } else {
    insertTanaman(lokasi || null, null);
  }
});

app.put("/api/tanaman/:id", upload.single("gambar"), (req, res) => {
  const {
    nama,
    jenis,
    lokasi,
    lokasi_id,
    deskripsi,
    kondisi,
    usia,
    jadwal_siram,
    jadwal_pupuk,
    jadwal_panen,
    penanggung_jawab,
    kebutuhan_air,
    terakhir_dipupuk,
  } = req.body;

  const updateTanaman = (lokasiNama, idLokasi) => {
    if (req.file) {
      db.query(
        "UPDATE tanaman SET nama=?, jenis=?, lokasi=?, lokasi_id=?, deskripsi=?, kondisi=?, gambar=?, usia=?, jadwal_siram=?, jadwal_pupuk=?, jadwal_panen=?, penanggung_jawab=?, kebutuhan_air=?, terakhir_dipupuk=? WHERE id=?",
        [
          nama,
          jenis,
          lokasiNama,
          idLokasi,
          deskripsi,
          kondisi || "Sehat",
          req.file.filename,
          usia,
          jadwal_siram,
          jadwal_pupuk,
          jadwal_panen,
          penanggung_jawab,
          kebutuhan_air,
          terakhir_dipupuk,
          req.params.id,
        ],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Berhasil" });
        },
      );
    } else {
      db.query(
        "UPDATE tanaman SET nama=?, jenis=?, lokasi=?, lokasi_id=?, deskripsi=?, kondisi=?, usia=?, jadwal_siram=?, jadwal_pupuk=?, jadwal_panen=?, penanggung_jawab=?, kebutuhan_air=?, terakhir_dipupuk=? WHERE id=?",
        [
          nama,
          jenis,
          lokasiNama,
          idLokasi,
          deskripsi,
          kondisi || "Sehat",
          usia,
          jadwal_siram,
          jadwal_pupuk,
          jadwal_panen,
          penanggung_jawab,
          kebutuhan_air,
          terakhir_dipupuk,
          req.params.id,
        ],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Berhasil" });
        },
      );
    }
  };

  if (lokasi_id) {
    db.query(
      "SELECT nama FROM lokasi WHERE id = ? AND aktif = 1",
      [lokasi_id],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        updateTanaman(
          (rows.length ? rows[0].nama : null) || lokasi,
          lokasi_id || null,
        );
      },
    );
  } else {
    updateTanaman(lokasi || null, null);
  }
});

app.delete("/api/tanaman/:id", (req, res) => {
  db.query("DELETE FROM tanaman WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Berhasil" });
  });
});

// ==========================================
// API LOG PERAWATAN
// ==========================================
app.get("/api/log_perawatan", (req, res) => {
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

app.post("/api/log_perawatan", upload.single("gambar"), (req, res) => {
  const { tanaman_id, jenis_tindakan, nama_perawat, role_perawat } = req.body;
  const gambar = req.file ? req.file.filename : null;

  const finalNama = nama_perawat || "Pengunjung";
  const finalRole = role_perawat || "Pengunjung";

  db.query(
    "INSERT INTO log_perawatan (tanaman_id, perawat_id, role_perawat, jenis_tindakan, gambar, nama_perawat) VALUES (?, ?, ?, ?, ?, ?)",
    [tanaman_id, 0, finalRole, jenis_tindakan, gambar, finalNama],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Perawatan berhasil dicatat" });
    },
  );
});
// API FOTO PERKEMBANGAN
app.get("/api/foto_perkembangan/:tanaman_id", (req, res) => {
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

app.post(
  "/api/foto_perkembangan",
  authenticateSantriToken,
  upload.single("gambar"),
  (req, res) => {
    const { tanaman_id } = req.body;
    const user_id = req.user.id;
    const role = req.user.role || "Santri";
    const gambar = req.file ? req.file.filename : null;

    if (!gambar)
      return res.status(400).json({ error: "Gambar wajib diunggah" });

    let santri_id = null;
    let petani_id = null;
    if (role === "Petani") {
      petani_id = user_id;
    } else {
      santri_id = user_id;
    }

    db.query(
      "INSERT INTO foto_perkembangan (tanaman_id, santri_id, petani_id, gambar) VALUES (?, ?, ?, ?)",
      [tanaman_id, santri_id, petani_id, gambar],
      (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
          message: "Foto perkembangan berhasil diunggah",
          id: results.insertId,
          gambar,
        });
      },
    );
  },
);

// ==========================================
// API RIWAYAT PERAWATAN
// ==========================================
app.post("/api/tanaman/:id/aksi", (req, res) => {
  const { tipe_aksi, nama_perawat, role_perawat, user_id } = req.body;
  const tanaman_id = req.params.id;
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Akses ditolak. Belum login." });
  }

  jwt.verify(
    token,
    process.env.JWT_SECRET || "alfilaha_super_secret_key_2026",
    (err, user) => {
      if (err)
        return res
          .status(403)
          .json({ message: "Token tidak valid atau sudah kadaluarsa." });

      // Check if it's santri token or internal user token
      // Santri tokens have user.id from pendaftar_santri table
      // Internal user tokens have user.id from admin_users table

      // First check santri table
      db.query(
        "SELECT id, nama, username, status_pendaftaran FROM pendaftar_santri WHERE id = ?",
        [user.id],
        (err, santriResults) => {
          if (err)
            return res
              .status(500)
              .json({ message: "Terjadi kesalahan database." });

          if (santriResults.length > 0) {
            // This is a santri
            const santri = santriResults[0];

            if (santri.status_pendaftaran !== "Diterima") {
              return res.status(403).json({
                message:
                  "Maaf, Anda belum diterima sebagai santri. Silakan tunggu konfirmasi dari admin.",
                status: santri.status_pendaftaran,
              });
            }

            // Insert with santri_id — nama_perawat diambil dari body request atau DB
            const finalNamaPerawat = nama_perawat || santri.nama;
            const finalRolePerawat = role_perawat || "Santri";
            const finalUserId = user_id || santri.id;

            const query = `
          INSERT INTO log_perawatan (tanaman_id, santri_id, jenis_tindakan, nama_perawat, role_perawat, waktu_tindakan)
          VALUES (?, ?, ?, ?, ?, NOW())
        `;

            db.query(
              query,
              [
                tanaman_id,
                finalUserId,
                tipe_aksi,
                finalNamaPerawat,
                finalRolePerawat,
              ],
              (err, results) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({
                  message: "Tindakan berhasil dicatat",
                  id: results.insertId,
                });
              },
            );
          } else {
            // This might be an internal user (admin/petugas), check admin_users table
            db.query(
              "SELECT id, username, nama_lengkap, role FROM admin_users WHERE id = ?",
              [user.id],
              (err, adminResults) => {
                if (err)
                  return res
                    .status(500)
                    .json({ message: "Terjadi kesalahan database." });

                if (adminResults.length > 0) {
                  // This is an internal user
                  const admin = adminResults[0];

                  // Insert without santri_id (NULL)
                  const finalNamaPerawat =
                    nama_perawat ||
                    admin.nama_lengkap ||
                    admin.username ||
                    "Petugas";
                  const finalRolePerawat =
                    role_perawat || admin.role || "Petugas";

                  const query = `
              INSERT INTO log_perawatan (tanaman_id, santri_id, jenis_tindakan, nama_perawat, role_perawat, waktu_tindakan)
              VALUES (?, NULL, ?, ?, ?, NOW())
            `;

                  db.query(
                    query,
                    [tanaman_id, tipe_aksi, finalNamaPerawat, finalRolePerawat],
                    (err, results) => {
                      if (err)
                        return res.status(500).json({ error: err.message });
                      res.json({
                        message: "Tindakan berhasil dicatat",
                        id: results.insertId,
                      });
                    },
                  );
                } else {
                  return res
                    .status(404)
                    .json({ message: "User tidak ditemukan." });
                }
              },
            );
          }
        },
      );
    },
  );
});

// Riwayat perawatan tanaman — publik (tanpa auth) supaya halaman tanaman yang
// sudah dipublikasikan menampilkan bukti pekerjaan (foto + laporan singkat).
// Mendukung pagination (?page&limit), pencarian (?q) dan filter aksi (?aksi).
// Bila `limit` tidak dikirim, perilaku lama (array penuh) tetap dipertahankan
// agar pemakaian lama tidak rusak.
app.get("/api/tanaman/:id/riwayat", (req, res) => {
  const tanaman_id = req.params.id;
  const paginasi = req.query.limit !== undefined;

  const where = ["l.tanaman_id = ?"];
  const params = [tanaman_id];

  const q = String(req.query.q || "").trim();
  if (q) {
    where.push(
      "(sch.nama_aktivitas LIKE ? OR l.nama_perawat LIKE ? OR s.nama LIKE ? OR l.laporan_singkat LIKE ?)",
    );
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const aksi = String(req.query.aksi || "").trim();
  if (aksi && aksi.toLowerCase() !== "semua") {
    where.push("l.jenis_tindakan = ?");
    params.push(aksi);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const selectSql = `
    SELECT l.id, l.tanaman_id, l.jadwal_id, l.jenis_tindakan, l.waktu_tindakan, l.nama_perawat, l.role_perawat,
           l.laporan_singkat, l.gambar,
           t.nama AS nama_tanaman, s.nama AS nama_santri,
           sch.nama_aktivitas AS nama_aktivitas
    FROM log_perawatan l
    JOIN tanaman t ON l.tanaman_id = t.id
    LEFT JOIN pendaftar_santri s ON l.santri_id = s.id
    LEFT JOIN activity_schedules sch ON sch.id = l.jadwal_id
    ${whereSql}
    ORDER BY l.waktu_tindakan DESC
  `;

  if (!paginasi) {
    return db.query(selectSql, params, (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    });
  }

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 5));
  const offset = (page - 1) * limit;

  const countSql = `
    SELECT COUNT(*) AS total
    FROM log_perawatan l
    JOIN tanaman t ON l.tanaman_id = t.id
    LEFT JOIN pendaftar_santri s ON l.santri_id = s.id
    LEFT JOIN activity_schedules sch ON sch.id = l.jadwal_id
    ${whereSql}
  `;

  db.query(countSql, params, (errC, rowsC) => {
    if (errC) return res.status(500).json({ error: errC.message });
    const total = rowsC && rowsC[0] ? Number(rowsC[0].total) : 0;

    db.query(
      `${selectSql} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
      (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
          items: results,
          total,
          page,
          limit,
          hasMore: offset + results.length < total,
        });
      },
    );
  });
});

// Ringkasan statistik perawatan (total + tanggal terakhir per aksi) — hanya
// beberapa baris, supaya halaman detail tidak perlu mengambil semua riwayat.
app.get("/api/tanaman/:id/stats", (req, res) => {
  const query = `
    SELECT jenis_tindakan,
           COUNT(*) AS total,
           MAX(waktu_tindakan) AS terakhir
    FROM log_perawatan
    WHERE tanaman_id = ?
    GROUP BY jenis_tindakan
  `;
  db.query(query, [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const hasil = {};
    (rows || []).forEach((r) => {
      hasil[String(r.jenis_tindakan || "").toLowerCase()] = {
        total: Number(r.total) || 0,
        terakhir: r.terakhir || null,
      };
    });
    res.json(hasil);
  });
});

// ============================================================
// SISTEM JADWAL AKTIVITAS PONDOK
// ============================================================

// Pastikan tabel jadwal ada saat server start
const jadwalTables = [
  `CREATE TABLE IF NOT EXISTS activity_schedules (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    nama_aktivitas   VARCHAR(255) NOT NULL,
    kategori         VARCHAR(100) NOT NULL DEFAULT 'Lainnya',
    deskripsi        TEXT,
    pola_perulangan  ENUM('sekali','harian','mingguan','bulanan','berulang') NOT NULL DEFAULT 'mingguan',
    interval_hari    INT NOT NULL DEFAULT 7,
    tanggal_mulai    DATE NOT NULL,
    tanggal_selesai  DATE NULL,
    penanggung_jawab INT NULL,
    status           ENUM('aktif','nonaktif','selesai') NOT NULL DEFAULT 'aktif',
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (penanggung_jawab) REFERENCES pendaftar_santri(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

(function createJadwalTablesSeq(idx) {
  if (idx >= jadwalTables.length) return;
  db.query(jadwalTables[idx], (err) => {
    if (err && err.code !== "ER_TABLE_EXISTS_ERROR") {
      console.error(`[Jadwal Table ${idx + 1}] Error:`, err.message);
    } else {
      console.log(`[Jadwal Table ${idx + 1}] ✅ Siap`);
    }
    createJadwalTablesSeq(idx + 1);
  });
})(0);

// Helper: format tanggal ke YYYY-MM-DD (timezone-safe)
function toDateStr(d) {
  const dd = new Date(d);
  const y = dd.getFullYear();
  const m = String(dd.getMonth() + 1).padStart(2, "0");
  const day = String(dd.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Helper: tanggal berikutnya (>= dari tanggal acuan) yang jatuh pada `hari`
// tertentu (Senin..Sabtu). Dipakai untuk menempatkan tiket pelajaran pada
// hari yang sesuai jadwal pelajarannya.
const HARI_INDEX = { Minggu: 0, Senin: 1, Selasa: 2, Rabu: 3, Kamis: 4, Jumat: 5, Sabtu: 6 };
function tanggalBerikutUntukHari(hari, dariTanggal) {
  const target = HARI_INDEX[hari];
  if (target === undefined) return toDateStr(dariTanggal || new Date());
  const d = dariTanggal ? new Date(dariTanggal) : new Date();
  d.setHours(0, 0, 0, 0);
  const cur = d.getDay();
  let diff = target - cur;
  if (diff < 0) diff += 7;
  d.setDate(d.getDate() + diff);
  return toDateStr(d);
}

// Helper: susun daftar pelajaran terpilih menjadi teks terstruktur, dikelompokkan
// per hari, untuk disimpan di kolom deskripsi jadwal/tiket.
// Contoh keluaran:
//   Jadwal Pelajaran:
//   Senin
//   • B.Inggris (07:00-08:00) — Ustadz Ahmad
//   • Matematika (07:00-08:00) — Ustadz Agung
function bangunDaftarPelajaranTeks(pelajaranList) {
  if (!Array.isArray(pelajaranList) || pelajaranList.length === 0) return "";
  const urutHari = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const perHari = {};
  pelajaranList.forEach((j) => {
    const hari = String(j.hari || "").trim();
    if (!perHari[hari]) perHari[hari] = [];
    perHari[hari].push(j);
  });
  const baris = ["Jadwal Pelajaran:"];
  urutHari
    .filter((h) => perHari[h])
    .forEach((hari) => {
      baris.push(hari);
      perHari[hari]
        .sort((a, b) =>
          String(a.jam_mulai || "").localeCompare(String(b.jam_mulai || "")),
        )
        .forEach((j) => {
          const jamA = String(j.jam_mulai || "").slice(0, 5);
          const jamB = String(j.jam_selesai || "").slice(0, 5);
          const jam = jamA && jamB ? `${jamA}-${jamB}` : jamA || jamB || "";
          const guru = String(j.guru_nama || "").trim();
          baris.push(
            `• ${String(j.mapel).trim()}${jam ? ` (${jam})` : ""}${
              guru ? ` — ${guru}` : ""
            }`,
          );
        });
    });
  return baris.join("\n");
}

// Helper: generate semua tiket untuk satu jadwal dari tanggal_mulai s/d hari ini
// JUGA generate tiket untuk tanggal_mulai yang masih di masa depan (agar terlihat di dashboard)
function generateTiketUntukJadwal(sch, namaSantri, callback) {
  const todayStr = toDateStr(new Date());
  const mulai = new Date(sch.tanggal_mulai);
  mulai.setHours(0, 0, 0, 0);
  const today = new Date(todayStr);
  today.setHours(0, 0, 0, 0);

  const tanggalList = [];

  if (sch.pola_perulangan === "sekali") {
    // Buat tiket untuk tanggal_mulai, baik itu hari ini, kemarin, maupun masa depan
    tanggalList.push(toDateStr(mulai));
  } else {
    if (mulai > today) {
      // Jadwal mulai di masa depan — buat tiket untuk tanggal_mulai saja
      // agar santri bisa melihat tugas mendatangnya
      tanggalList.push(toDateStr(mulai));
    } else {
      // Generate dari tanggal_mulai s/d hari ini + 1 periode ke depan
      // agar tugas hari ini (atau mendatang terdekat) selalu ada
      const batasAkhir = new Date(
        today.getTime() + sch.interval_hari * 24 * 60 * 60 * 1000,
      );
      let cur = new Date(mulai);
      while (cur <= batasAkhir) {
        tanggalList.push(toDateStr(cur));
        cur = new Date(cur.getTime() + sch.interval_hari * 24 * 60 * 60 * 1000);
      }
    }
  }

  if (tanggalList.length === 0) return callback && callback();

  let done = 0;
  tanggalList.forEach((tgl) => {
    db.query(
      `INSERT IGNORE INTO activity_tasks (schedule_id, santri_id, nama_santri, tanggal_tugas, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [sch.id, sch.penanggung_jawab, namaSantri, tgl],
      () => {
        done++;
        if (done === tanggalList.length && callback) callback();
      },
    );
  });
}

// Helper baru: generate tiket untuk multiple santri sekaligus
function generateTiketUntukMultipleSantri(sch, santriList, callback) {
  if (!santriList || santriList.length === 0) return callback && callback();

  let completed = 0;
  const total = santriList.length;

  santriList.forEach((santri) => {
    const schWithSantri = { ...sch, penanggung_jawab: santri.id };
    generateTiketUntukJadwal(schWithSantri, santri.nama, () => {
      completed++;
      if (completed === total && callback) callback();
    });
  });
}

// CRON harian: generate tiket jam 00:01
function generateTiketHarian() {
  const todayStr = toDateStr(new Date());
  console.log(`[CRON] Generate tiket: ${todayStr}`);

  db.query(
    `SELECT s.*, p.nama AS nama_penanggung
     FROM activity_schedules s
     LEFT JOIN pendaftar_santri p ON s.penanggung_jawab = p.id
     WHERE s.status = 'aktif'
       AND s.tanggal_mulai <= ?
       AND (s.tanggal_selesai IS NULL OR s.tanggal_selesai >= ?)`,
    [todayStr, todayStr],
    (err, schedules) => {
      if (err) {
        console.error("[CRON] Error:", err.message);
        return;
      }
      schedules.forEach((sch) => {
        const mulai = new Date(sch.tanggal_mulai);
        mulai.setHours(0, 0, 0, 0);
        const today = new Date(todayStr);
        today.setHours(0, 0, 0, 0);
        const selisih = Math.round((today - mulai) / (1000 * 60 * 60 * 24));
        let jatuhTempo =
          sch.pola_perulangan === "sekali"
            ? selisih === 0
            : selisih >= 0 && selisih % sch.interval_hari === 0;
        if (!jatuhTempo) return;

        db.query(
          `INSERT IGNORE INTO activity_tasks (schedule_id, santri_id, nama_santri, tanggal_tugas, status)
           VALUES (?, ?, ?, ?, 'pending')`,
          [sch.id, sch.penanggung_jawab, sch.nama_penanggung, todayStr],
          (e) => {
            if (e)
              console.error(
                `[CRON] Gagal tiket schedule ${sch.id}:`,
                e.message,
              );
          },
        );
        if (sch.pola_perulangan === "sekali") {
          db.query(
            "UPDATE activity_schedules SET status='selesai' WHERE id=?",
            [sch.id],
          );
        }
      });
    },
  );
}

(function scheduleCron() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(0, 1, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  const msUntil = target - now;
  setTimeout(() => {
    generateTiketHarian();
    setInterval(generateTiketHarian, 24 * 60 * 60 * 1000);
  }, msUntil);
  console.log(
    `[CRON] Dijadwalkan jam 00:01 (dalam ${Math.round(msUntil / 60000)} menit)`,
  );
})();
setTimeout(generateTiketHarian, 5000); // jalankan sekali saat startup

// ── ENDPOINTS JADWAL ─────────────────────────────────────────────────────────

// Health-check tabel jadwal (dicek frontend sebelum submit)
app.get("/api/jadwal-test", (req, res) => {
  db.query("SELECT COUNT(*) AS total FROM activity_schedules", (err) => {
    if (err)
      return res
        .status(200)
        .json({
          ok: false,
          activity_schedules_exists: false,
          error: err.message,
        });
    res.json({ ok: true, activity_schedules_exists: true });
  });
});

// Daftar santri untuk dropdown admin — hanya yang sudah Diterima
// Sertakan juga jumlah tugas aktif (pending) agar admin tahu beban kerja santri
app.get("/api/santri-terdaftar", (req, res) => {
  const q = `
    SELECT
      p.id,
      p.nama,
      p.username,
      p.status_pendaftaran,
      p.no_wa,
      p.created_at,
      COUNT(CASE WHEN t.status = 'pending' THEN 1 END) AS tugas_aktif,
      COUNT(CASE WHEN t.status = 'selesai' THEN 1 END) AS tugas_selesai,
      COUNT(t.id) AS total_tugas
    FROM pendaftar_santri p
    LEFT JOIN activity_tasks t ON t.santri_id = p.id
    WHERE p.status_pendaftaran = 'Diterima'
    GROUP BY p.id, p.nama, p.username, p.status_pendaftaran, p.no_wa, p.created_at
    ORDER BY p.nama ASC
  `;
  db.query(q, (err, results) => {
    if (err) {
      // Fallback tanpa join jika tabel activity_tasks belum ada
      db.query(
        `SELECT id, nama, username, status_pendaftaran, no_wa, created_at
         FROM pendaftar_santri
         WHERE status_pendaftaran = 'Diterima'
         ORDER BY nama ASC`,
        (err2, r2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json(r2 || []);
        },
      );
      return;
    }
    res.json(results || []);
  });
});

// Rekap kinerja santri
app.get("/api/rekap-tugas", (req, res) => {
  db.query(
    `SELECT t.santri_id, t.nama_santri,
       COUNT(*) AS total_tugas,
       SUM(t.status='selesai') AS selesai,
       SUM(t.status='pending') AS pending,
       SUM(t.status='dilewati') AS dilewati,
       ROUND(SUM(t.status='selesai')/COUNT(*)*100,1) AS persen_selesai
     FROM activity_tasks t
     GROUP BY t.santri_id, t.nama_santri
     ORDER BY selesai DESC`,
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    },
  );
});

// ── IDENTITAS (SAYA) ───────────────────────────────────────────────────────────
// Middleware identitas: token santri ATAU admin → lengkapi profil
const authenticateIdentity = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token)
    return res.status(401).json({ message: "Akses ditolak. Belum login." });

  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err)
      return res
        .status(403)
        .json({ message: "Token tidak valid atau sudah kadaluarsa." });

    db.query(
      "SELECT id, nama, username, status_pendaftaran FROM pendaftar_santri WHERE id = ?",
      [payload.id],
      (errS, santriResults) => {
        if (errS)
          return res
            .status(500)
            .json({ message: "Terjadi kesalahan database." });

        if (santriResults.length > 0) {
          const s = santriResults[0];
          req.user = {
            id: s.id,
            nama: s.nama,
            username: s.username,
            role: "Santri",
            status: s.status_pendaftaran,
            status_pendaftaran: s.status_pendaftaran,
            userType: "santri",
          };
          return next();
        }

        db.query(
          "SELECT id, username, nama_lengkap, role FROM admin_users WHERE id = ?",
          [payload.id],
          (errA, adminResults) => {
            if (errA)
              return res
                .status(500)
                .json({ message: "Terjadi kesalahan database." });
            if (adminResults.length === 0)
              return res.status(404).json({ message: "User tidak ditemukan." });

            const a = adminResults[0];
            req.user = {
              id: a.id,
              username: a.username,
              nama: a.nama_lengkap || a.username,
              role: a.role || "Admin",
              status: "Diterima",
              status_pendaftaran: "Diterima",
              userType: "internal",
            };
            return next();
          },
        );
      },
    );
  });
};

// GET identitas akun yang sedang login (santri maupun admin)
app.get("/api/me", authenticateIdentity, (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    nama: req.user.nama,
    role: req.user.role,
    status: req.user.status,
    status_pendaftaran: req.user.status_pendaftaran,
  });
});

// ── HELPER JADWAL (lokasi + kegiatan + relasi pivot) ───────────────────────────

// Helper: kumpulkan santri_ids (bisa dari `santri_ids` array atau `penanggung_jawab` CSV)
function kumpulkanSantriIds(body) {
  const raw =
    body.santri_ids !== undefined ? body.santri_ids : body.penanggung_jawab;
  let arr = [];
  if (Array.isArray(raw)) arr = raw;
  else if (raw != null && raw !== "") arr = String(raw).split(",");
  const ids = arr
    .map((id) => parseInt(String(id).trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(ids)];
}

// Helper: verifikasi semua santri berstatus "diterima"
function verifikasiSantriDiterima(ids, cb) {
  if (!ids.length) return cb([], null);
  const placeholders = ids.map(() => "?").join(",");
  const q = `SELECT id, status_pendaftaran FROM pendaftar_santri
             WHERE id IN (${placeholders})
             AND LOWER(TRIM(status_pendaftaran)) = 'diterima'`;
  db.query(q, ids, (err, rows) => {
    if (err) return cb([], err);
    const valid = new Set((rows || []).map((r) => Number(r.id)));
    cb(
      ids.filter((id) => !valid.has(Number(id))),
      null,
    );
  });
}

// Helper: ubah array (bisa berisi string/angka) menjadi array id unik positif
function kumpulkanIdArray(raw) {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .map((id) => parseInt(String(id).trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ];
}

// Helper: pastikan ada nama kategori sebagai string (kolom kategori NOT NULL)
function ambilNamaKategori(kategori, kategoriId, cb) {
  if (kategori && String(kategori).trim()) return cb(String(kategori).trim());
  if (!kategoriId) return cb("Lainnya");
  db.query(
    "SELECT nama FROM kategori WHERE id = ?",
    [kategoriId],
    (err, rows) => {
      if (err || !rows || !rows.length) return cb("Lainnya");
      cb(rows[0].nama);
    },
  );
}

// Helper: verifikasi semua kegiatan benar-benar milik lokasi terpilih
function verifikasiKegiatanMilikLokasi(lokasiId, kegiatanIds, cb) {
  if (!kegiatanIds.length) return cb(null, 0);
  const placeholders = kegiatanIds.map(() => "?").join(",");
  db.query(
    `SELECT COUNT(*) AS c FROM kegiatan_lokasi WHERE lokasi_id = ? AND id IN (${placeholders})`,
    [lokasiId, ...kegiatanIds],
    (err, rows) => {
      if (err) return cb(err);
      cb(null, rows && rows.length ? rows[0].c : 0);
    },
  );
}

// Helper: pastikan semua tanaman benar-benar milik lokasi terpilih
function verifikasiTanamanMilikLokasi(lokasiId, tanamanIds, cb) {
  // Tanpa lokasi terpilih tidak ada "pemilik lokasi" yang bisa dibandingkan.
  // Form kategori produksi (pertanian/perkebunan/peternakan) memang tidak punya
  // kolom lokasi dan mengirim lokasi_id "", yang di-cast MySQL jadi 0 — sehingga
  // sebelumnya semua tanaman selalu dianggap "bukan milik lokasi" dan penyimpanan
  // ditolak. Verifikasi hanya bermakna kalau lokasi benar-benar dipilih.
  const lokasi = parseInt(lokasiId, 10);
  if (!Number.isInteger(lokasi) || lokasi <= 0) return cb(null, []);
  if (!tanamanIds.length) return cb(null, []);
  const placeholders = tanamanIds.map(() => "?").join(",");
  db.query(
    `SELECT t.id, t.nama FROM tanaman t
      WHERE t.id IN (${placeholders})
        AND (t.lokasi_id IS NULL OR t.lokasi_id <> ?)`,
    [...tanamanIds, lokasi],
    (err, rows) => {
      if (err) return cb(err);
      cb(null, rows || []);
    },
  );
}

// Helper: ubah nilai form jadi INT atau null (string kosong "tidak dipilih").
function normalisasiIdInt(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (str === "") return null;
  const num = Number(str);
  return Number.isInteger(num) ? num : null;
}

// Helper: pivot aktivitas_tanaman → [{ tanaman_id, nama, gambar, aksi: [] }]
function kelompokkanTanamanPivot(rows) {
  const map = new Map();
  (rows || []).forEach((r) => {
    const key = Number(r.tanaman_id);
    if (!map.has(key))
      map.set(key, {
        tanaman_id: key,
        nama: r.nama,
        gambar: r.gambar,
        aksi: [],
      });
    if (r.aksi) map.get(key).aksi.push(r.aksi);
  });
  return [...map.values()];
}

// Helper: pivot aktivitas_ternak → [{ ternak_id, nama, foto, aksi: [master_aksi_id] }]
function kelompokkanTernakPivot(rows) {
  const map = new Map();
  (rows || []).forEach((r) => {
    const key = Number(r.ternak_id);
    if (!map.has(key))
      map.set(key, { ternak_id: key, nama: r.nama, foto: r.foto, aksi: [] });
    if (r.master_aksi_id) map.get(key).aksi.push(Number(r.master_aksi_id));
  });
  return [...map.values()];
}

// Helper: normalisasi pilihan tanaman menjadi [{ id, aksi: [] }].
// Format baru `tanaman_terpilih` = [{ tanaman_id, aksi: ['siram',...] }]
// atau format lama `tanaman_ids` = [1,2,...] (tanpa aksi, lintas kategori).
function normalisasiTanamanTerpilih(body) {
  const raw = body.tanaman_terpilih;
  const legacy = kumpulkanIdArray(body.tanaman_ids);
  const hasil = new Map();
  const tambah = (id, aksi) => {
    const key = parseInt(String(id).trim(), 10);
    if (!Number.isFinite(key) || key <= 0) return;
    if (!hasil.has(key)) hasil.set(key, new Set());
    if (Array.isArray(aksi)) {
      aksi.forEach((a) => {
        const aStr = String(a).trim().toLowerCase();
        if (aStr && aStr.length <= 100) hasil.get(key).add(aStr);
      });
    }
  };
  if (Array.isArray(raw) && raw.length > 0) {
    raw.forEach((item) => {
      if (!item || typeof item !== "object") return;
      tambah(
        item.tanaman_id !== undefined ? item.tanaman_id : item.id,
        item.aksi,
      );
    });
  } else {
    legacy.forEach((id) => tambah(id, []));
  }
  return [...hasil.entries()].map(([id, setAksi]) => ({
    id,
    aksi: [...setAksi],
  }));
}

// Helper: normalisasi pilihan ternak menjadi [{ id, master_aksi_ids: [] }].
// `ternak_terpilih` = [{ ternak_id, aksi: [master_aksi_id, ...] }].
function normalisasiTernakTerpilih(body) {
  const raw = body.ternak_terpilih;
  const hasil = new Map();
  const tambah = (id, aksi) => {
    const key = parseInt(String(id).trim(), 10);
    if (!Number.isFinite(key) || key <= 0) return;
    if (!hasil.has(key)) hasil.set(key, new Set());
    if (Array.isArray(aksi)) {
      aksi.forEach((a) => {
        const s = String(a).trim();
        const aId = parseInt(s, 10);
        if (Number.isFinite(aId) && aId > 0) {
          hasil.get(key).add(aId);
          return;
        }
        // fallback jika frontend mengirim nama/objek
        if (s) {
          const maybe = parseInt(s.replace(/[^0-9]/g, ""), 10);
          if (Number.isFinite(maybe) && maybe > 0) hasil.get(key).add(maybe);
        }
      });
    }
  };
  if (Array.isArray(raw) && raw.length > 0) {
    raw.forEach((item) => {
      if (!item || typeof item !== "object") return;
      tambah(
        item.ternak_id !== undefined ? item.ternak_id : item.id,
        item.aksi,
      );
    });
  }
  return [...hasil.entries()].map(([id, s]) => ({
    id,
    master_aksi_ids: [...s],
  }));
}

// Helper: string info tanaman untuk tugas
// (GROUP_CONCAT "tanaman_id||nama||aksi;;tanaman_id||nama||aksi")
function tanamanInfoSubquery(aliasS = "s") {
  return `(SELECT GROUP_CONCAT(CONCAT(at.tanaman_id, '||', t.nama, '||', at.aksi) SEPARATOR ';;')
            FROM aktivitas_tanaman at
            JOIN tanaman t ON t.id = at.tanaman_id
           WHERE at.aktivitas_id = ${aliasS}.id AND at.aksi IS NOT NULL)`;
}

// Helper: string info ternak untuk tugas
// (GROUP_CONCAT "ternak_id||nama||master_aksi_id||namaAksi;;...")
function ternakInfoSubquery(aliasS = "s") {
  return `(SELECT GROUP_CONCAT(CONCAT(tk.id, '||', tr.nama, '||', m.id, '||', m.nama_aksi, IFNULL(CONCAT(' (', m.sub_aksi, ')'), '')) SEPARATOR ';;')
            FROM aktivitas_ternak atr
            JOIN ternak tk ON tk.id = atr.ternak_id
            JOIN jenis_ternak tr ON tr.id = tk.jenis_ternak_id
            JOIN master_aksi_ternak m ON m.id = atr.master_aksi_id
           WHERE atr.aktivitas_id = ${aliasS}.id AND atr.master_aksi_id IS NOT NULL)`;
}

// Helper: jumlah rekan (Santri lain) yang punya tiket untuk schedule dan tanggal
// yang sama. Dipakai buat badge "Status Rekan" di dashboard Santri.
function jumlahRekanSubquery(aliasT = "t") {
  return `(SELECT COUNT(*)
            FROM activity_tasks rt
           WHERE rt.schedule_id = ${aliasT}.schedule_id
             AND rt.tanggal_tugas = ${aliasT}.tanggal_tugas
             AND rt.santri_id IS NOT NULL
             AND rt.santri_id <> ${aliasT}.santri_id)`;
}

// Helper: simpan relasi kegiatan/tanaman/ternak/santri ke pivot (replace seluruhnya)
// tanamanData: [{ id, aksi: [] }] — tiap aksi jadi SATU baris aktivitas_tanaman
// (aksi NULL bila tidak ada aksi).
// ternakData: [{ id, master_aksi_ids: [] }] — tiap aksi jadi SATU baris aktivitas_ternak.
function simpanRelasiAktivitas(
  aktivitasId,
  kegiatanIds,
  tanamanData,
  ternakData,
  santriIds,
  cb,
) {
  const hapusSemua = (done) => {
    const tasks = [
      (cbx) =>
        db.query(
          "DELETE FROM aktivitas_kegiatan WHERE aktivitas_id=?",
          [aktivitasId],
          cbx,
        ),
      (cbx) =>
        db.query(
          "DELETE FROM aktivitas_tanaman WHERE aktivitas_id=?",
          [aktivitasId],
          cbx,
        ),
      (cbx) =>
        db.query(
          "DELETE FROM aktivitas_ternak WHERE aktivitas_id=?",
          [aktivitasId],
          cbx,
        ),
      (cbx) =>
        db.query(
          "DELETE FROM aktivitas_santri WHERE aktivitas_id=?",
          [aktivitasId],
          cbx,
        ),
    ];
    let i = 0;
    const next = () => {
      if (i >= tasks.length) return done(null);
      tasks[i++]((e) => (e ? done(e) : next()));
    };
    next();
  };

  const insertBatch = (tabel, ids, done) => {
    if (!ids.length) return done(null);
    let i = 0;
    const next = () => {
      if (i >= ids.length) return done(null);
      const id = ids[i++];
      db.query(
        `INSERT IGNORE INTO ${tabel} (aktivitas_id, ${tabel === "aktivitas_santri" ? "santri_id" : "kegiatan_id"}) VALUES (?, ?)`,
        [aktivitasId, id],
        (e) => (e ? done(e) : next()),
      );
    };
    next();
  };

  // Tanaman dipilih: satu baris per aksi (jika tidak ada aksi → satu baris aksi NULL)
  const insertTanaman = (plants, done) => {
    if (!plants.length) return done(null);
    let i = 0;
    const next = () => {
      if (i >= plants.length) return done(null);
      const p = plants[i++];
      const aksiList = p.aksi && p.aksi.length ? p.aksi : [null];
      let j = 0;
      const nextAksi = () => {
        if (j >= aksiList.length) return next();
        const aksi = aksiList[j++];
        db.query(
          "INSERT IGNORE INTO aktivitas_tanaman (aktivitas_id, tanaman_id, aksi) VALUES (?, ?, ?)",
          [aktivitasId, p.id, aksi],
          (e) => (e ? done(e) : nextAksi()),
        );
      };
      nextAksi();
    };
    next();
  };

  // Ternak dipilih: satu baris per master_aksi_id (pivot aktivitas_ternak)
  const insertTernak = (ternaks, done) => {
    if (!ternaks.length) return done(null);
    let i = 0;
    const next = () => {
      if (i >= ternaks.length) return done(null);
      const t = ternaks[i++];
      const aksiList =
        t.master_aksi_ids && t.master_aksi_ids.length
          ? t.master_aksi_ids
          : [null];
      let j = 0;
      const nextAksi = () => {
        if (j >= aksiList.length) return next();
        const mid = aksiList[j++];
        db.query(
          "INSERT IGNORE INTO aktivitas_ternak (aktivitas_id, ternak_id, master_aksi_id) VALUES (?, ?, ?)",
          [aktivitasId, t.id, mid],
          (e) => (e ? done(e) : nextAksi()),
        );
      };
      nextAksi();
    };
    next();
  };

  hapusSemua((errHapus) => {
    if (errHapus) return cb(errHapus);
    insertBatch("aktivitas_kegiatan", kegiatanIds, (errK) => {
      if (errK) return cb(errK);
      insertTanaman(tanamanData || [], (errT) => {
        if (errT) return cb(errT);
        insertTernak(ternakData || [], (errTr) => {
          if (errTr) return cb(errTr);
          insertBatch("aktivitas_santri", santriIds, (errS) => cb(errS));
        });
      });
    });
  });
}

// GET semua jadwal
app.get("/api/jadwal", (req, res) => {
  db.query(
    `SELECT s.*, p.nama AS nama_pj, p.username AS username_pj
     FROM activity_schedules s
     LEFT JOIN pendaftar_santri p ON s.penanggung_jawab = p.id
     ORDER BY s.id DESC`,
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    },
  );
});

// GET detail satu jadwal
app.get("/api/jadwal/:id", (req, res) => {
  db.query(
    `SELECT s.*, p.nama AS nama_pj
     FROM activity_schedules s
     LEFT JOIN pendaftar_santri p ON s.penanggung_jawab = p.id
     WHERE s.id = ?`,
    [req.params.id],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!results.length)
        return res.status(404).json({ message: "Tidak ditemukan" });

      // Wajib ikut dikembalikan supaya form Edit bisa menandai tanaman/ternak
      // yang sudah terhubung. Tanpa ini form selalu buka dengan pilihan kosong.
      db.query(
        `SELECT at.tanaman_id, at.aksi, t.nama, t.gambar
           FROM aktivitas_tanaman at
           JOIN tanaman t ON t.id = at.tanaman_id
          WHERE at.aktivitas_id = ?
          ORDER BY at.id ASC`,
        [req.params.id],
        (err2, plants) => {
          if (err2) return res.status(500).json({ error: err2.message });
          db.query(
            `SELECT atr.ternak_id, atr.master_aksi_id, tr.nama, tk.foto
               FROM aktivitas_ternak atr
               JOIN ternak tk ON tk.id = atr.ternak_id
               JOIN jenis_ternak tr ON tr.id = tk.jenis_ternak_id
              WHERE atr.aktivitas_id = ?
              ORDER BY atr.id ASC`,
            [req.params.id],
            (err3, ternaks) => {
              if (err3) return res.status(500).json({ error: err3.message });
              db.query(
                `SELECT k.id, k.nama
                   FROM aktivitas_kegiatan ak
                   JOIN kegiatan_lokasi k ON k.id = ak.kegiatan_id
                  WHERE ak.aktivitas_id = ?
                  ORDER BY ak.id ASC`,
                [req.params.id],
                (err4, kegiatans) => {
                  res.json({
                    ...results[0],
                    tanaman_terpilih: kelompokkanTanamanPivot(plants),
                    ternak_terpilih: kelompokkanTernakPivot(ternaks),
                    kegiatan_terpilih: err4 ? [] : kegiatans,
                  });
                },
              );
            },
          );
        },
      );
    },
  );
});

// POST buat jadwal baru — verifikasi lokasi/kegiatan/tanaman/santri, simpan relasi pivot, generate tiket (multi-santri)
app.post("/api/jadwal", (req, res) => {
  const {
    nama_aktivitas,
    kategori,
    kategori_id,
    lokasi_id,
    sub_tugas,
    deskripsi,
    pola_perulangan,
    interval_hari,
    tanggal_mulai,
    jam_mulai,
    jam_selesai,
    tanggal_selesai,
  } = req.body;
  const santriIdArray = kumpulkanSantriIds(req.body);
  const kegiatanIds = kumpulkanIdArray(req.body.kegiatan_lokasi_ids);
  const tanamanData = normalisasiTanamanTerpilih(req.body);
  const ternakData = normalisasiTernakTerpilih(req.body);
  const tanamanIds = tanamanData.map((t) => t.id);

  verifikasiSantriDiterima(santriIdArray, (invalid, err) => {
    if (err) return res.status(500).json({ error: err.message });
    if (invalid.length > 0) {
      console.warn(
        `[POST /api/jadwal] DIBATALKAN — santri belum diterima: ${invalid.join(", ")}`,
      );
      return res
        .status(400)
        .json({
          error: `Terdapat santri yang belum berstatus "Diterima" (id: ${invalid.join(", ")}). Jadwal tidak disimpan.`,
        });
    }

    verifikasiKegiatanMilikLokasi(
      lokasi_id,
      kegiatanIds,
      (errK, jumlahCocok) => {
        if (errK) return res.status(500).json({ error: errK.message });
        if (jumlahCocok !== kegiatanIds.length) {
          return res
            .status(400)
            .json({
              error:
                "Terdapat kegiatan yang bukan milik lokasi yang dipilih. Pilih ulang kegiatan untuk lokasi ini.",
            });
        }

        ambilNamaKategori(kategori, kategori_id, (namaKategoriPre) => {
          const isProduksiPre =
            /pertanian|perkebunan|peternakan|ternak|pendidikan/i.test(
              namaKategoriPre,
            );
          const checkTanaman = (cbCheck) => {
            if (isProduksiPre) return cbCheck(null, []);
            verifikasiTanamanMilikLokasi(lokasi_id, tanamanIds, cbCheck);
          };
          checkTanaman((errT, invalidTanaman) => {
            if (errT) return res.status(500).json({ error: errT.message });
            if (invalidTanaman && invalidTanaman.length > 0) {
              return res
                .status(400)
                .json({
                  error:
                    "Terdapat tanaman yang bukan milik lokasi terpilih: " +
                    invalidTanaman.map((t) => `"${t.nama}"`).join(", ") +
                    ". Kaitkan tanaman itu ke lokasi ini lewat Manajemen Tanaman.",
                });
            }
            ambilNamaKategori(kategori, kategori_id, (namaKategori) => {
              // Lokasi wajib untuk semua kategori; kegiatan bersifat opsional.
              if (!lokasi_id)
                return res.status(400).json({ error: "Lokasi wajib dipilih." });
              const lokasiFinal =
                lokasi_id === "" || lokasi_id === undefined ? null : lokasi_id;
              const penanggungJawabString =
                santriIdArray.length > 0 ? santriIdArray[0] : null;

              // Bila admin memilih jadwal pelajaran (kategori Pendidikan),
              // SEMUA pelajaran terpilih disatukan ke SATU jadwal/tiket.
              // Daftar pelajaran (hari, jam, guru) disimpan sebagai deskripsi
              // terstruktur agar tampil rapi pada kartu tiket & halaman santri.
              const pelajaranList = Array.isArray(req.body?.jadwal_pelajaran)
                ? req.body.jadwal_pelajaran.filter(
                    (j) =>
                      j &&
                      String(j.mapel || "").trim() &&
                      String(j.hari || "").trim(),
                  )
                : [];

              const jamPelajaran = pelajaranList
                .map((j) => String(j.jam_mulai || "").slice(0, 5))
                .filter(Boolean)
                .sort();
              const jamSelesaiPelajaran = pelajaranList
                .map((j) => String(j.jam_selesai || "").slice(0, 5))
                .filter(Boolean)
                .sort();

              const daftarPelajaranTeks = bangunDaftarPelajaranTeks(pelajaranList);
              const deskripsiFinal = pelajaranList.length
                ? [deskripsi, daftarPelajaranTeks]
                    .filter((s) => s && String(s).trim())
                    .join("\n\n")
                : deskripsi || null;

              const adaPelajaran = pelajaranList.length > 0;
              const polaFinal = adaPelajaran
                ? "mingguan"
                : pola_perulangan;
              const intervalFinal =
                polaFinal === "sekali" ? 1 : parseInt(interval_hari) || 7;
              const tanggalMulaiFinal = adaPelajaran
                ? tanggalBerikutUntukHari(
                    String(pelajaranList[0].hari).trim(),
                    tanggal_mulai,
                  )
                : tanggal_mulai;
              const jamMulaiFinal =
                (jamPelajaran.length ? jamPelajaran[0] : jam_mulai) || "08:00";
              const jamSelesaiFinal =
                (jamSelesaiPelajaran.length
                  ? jamSelesaiPelajaran[jamSelesaiPelajaran.length - 1]
                  : jam_selesai) || "09:00";

              const schedulePlan = {
                nama_aktivitas,
                pola_perulangan: polaFinal,
                interval_hari: intervalFinal,
                tanggal_mulai: tanggalMulaiFinal,
                jam_mulai: jamMulaiFinal,
                jam_selesai: jamSelesaiFinal,
                deskripsi: deskripsiFinal,
              };

              const plan = schedulePlan;
              db.query(
                  `INSERT INTO activity_schedules
                   (nama_aktivitas, kategori, kategori_id, lokasi_id, deskripsi, pola_perulangan, interval_hari,
                    tanggal_mulai, jam_mulai, jam_selesai, tanggal_selesai, penanggung_jawab)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    plan.nama_aktivitas,
                    namaKategori,
                    kategori_id || null,
                    lokasiFinal,
                    plan.deskripsi || null,
                    plan.pola_perulangan,
                    plan.interval_hari,
                    plan.tanggal_mulai,
                    plan.jam_mulai,
                    plan.jam_selesai,
                    tanggal_selesai || null,
                    penanggungJawabString,
                  ],
                  (errIns, result) => {
                    if (errIns) {
                      console.error(
                        "[POST /api/jadwal] DB Error:",
                        errIns.message,
                      );
                      return res.status(500).json({ error: errIns.message });
                    }
                    const scheduleId = result.insertId;
                    console.log(
                      `[POST /api/jadwal] Jadwal "${plan.nama_aktivitas}" tersimpan dengan ID: ${scheduleId}`,
                    );
                    simpanRelasiAktivitas(
                      scheduleId,
                      kegiatanIds,
                      tanamanData,
                      ternakData,
                      santriIdArray,
                      (errRel) => {
                        if (errRel)
                          console.error(
                            "[POST /api/jadwal] Gagal simpan relasi:",
                            errRel.message,
                          );
                        if (santriIdArray.length > 0) {
                          let completed = 0;
                          const total = santriIdArray.length;
                          santriIdArray.forEach((santriId) => {
                            db.query(
                              "SELECT nama FROM pendaftar_santri WHERE id=?",
                              [santriId],
                              (e, rows) => {
                                const namaSantri =
                                  rows && rows.length ? rows[0].nama : null;
                                const sch = {
                                  id: scheduleId,
                                  pola_perulangan: plan.pola_perulangan,
                                  interval_hari: plan.interval_hari,
                                  tanggal_mulai: plan.tanggal_mulai,
                                  penanggung_jawab: santriId,
                                };
                                generateTiketUntukJadwal(
                                  sch,
                                  namaSantri,
                                  () => {
                                    completed++;
                                    if (completed === total) {
                                      if (plan.pola_perulangan === "sekali") {
                                        db.query(
                                          "UPDATE activity_schedules SET status='selesai' WHERE id=?",
                                          [scheduleId],
                                        );
                                      }
                                      res.json({
                                        message: `Jadwal berhasil dibuat dan tiket sudah dikirim ke ${total} santri${
                                          pelajaranList.length > 0
                                            ? ` (${pelajaranList.length} pelajaran)`
                                            : ""
                                        }`,
                                        id: scheduleId,
                                      });
                                    }
                                  },
                                );
                              },
                            );
                          });
                        } else {
                          res.json({
                            message: "Jadwal berhasil dibuat",
                            id: scheduleId,
                          });
                        }
                      },
                    );
                  },
                );
            });
          });
        });
      },
    );
  });
});

// PUT update jadwal — jika PJ berubah, regenerate tiket pending mendatang ke PJ baru; update relasi lokasi/kegiatan
app.put("/api/jadwal/:id", (req, res) => {
  const {
    nama_aktivitas,
    kategori,
    kategori_id,
    lokasi_id,
    sub_tugas,
    deskripsi,
    pola_perulangan,
    interval_hari,
    tanggal_mulai,
    jam_mulai,
    jam_selesai,
    tanggal_selesai,
    status,
  } = req.body;
  const santriIdArray = kumpulkanSantriIds(req.body);
  const kegiatanIds = kumpulkanIdArray(req.body.kegiatan_lokasi_ids);
  const tanamanData = normalisasiTanamanTerpilih(req.body);
  const ternakData = normalisasiTernakTerpilih(req.body);
  const tanamanIds = tanamanData.map((t) => t.id);
  const penanggungJawabString =
    santriIdArray.length > 0 ? santriIdArray[0] : null;
  const interval =
    pola_perulangan === "sekali" ? 1 : parseInt(interval_hari) || 7;

  // Sama seperti POST: bila ada pelajaran terpilih (kategori Pendidikan),
  // satukan daftar pelajaran ke deskripsi dan pakai rentang jam pelajaran.
  const pelajaranListEdit = Array.isArray(req.body?.jadwal_pelajaran)
    ? req.body.jadwal_pelajaran.filter(
        (j) =>
          j && String(j.mapel || "").trim() && String(j.hari || "").trim(),
      )
    : [];
  let deskripsiFinalEdit = deskripsi || null;
  let jamMulaiFinalEdit = jam_mulai || "08:00";
  let jamSelesaiFinalEdit = jam_selesai || "09:00";
  if (pelajaranListEdit.length > 0) {
    const daftarTeks = bangunDaftarPelajaranTeks(pelajaranListEdit);
    deskripsiFinalEdit = [deskripsi, daftarTeks]
      .filter((s) => s && String(s).trim())
      .join("\n\n");
    const mulaiList = pelajaranListEdit
      .map((j) => String(j.jam_mulai || "").slice(0, 5))
      .filter(Boolean)
      .sort();
    const selesaiList = pelajaranListEdit
      .map((j) => String(j.jam_selesai || "").slice(0, 5))
      .filter(Boolean)
      .sort();
    if (mulaiList.length) jamMulaiFinalEdit = mulaiList[0];
    if (selesaiList.length)
      jamSelesaiFinalEdit = selesaiList[selesaiList.length - 1];
  }

  verifikasiSantriDiterima(santriIdArray, (invalid, err) => {
    if (err) return res.status(500).json({ error: err.message });
    if (invalid.length > 0) {
      return res
        .status(400)
        .json({
          error: `Terdapat santri yang belum berstatus "Diterima" (id: ${invalid.join(", ")}). Perubahan tidak disimpan.`,
        });
    }

    const lanjutUpdate = () => {
      ambilNamaKategori(kategori, kategori_id, (namaKategoriPreU) => {
        const isProduksiPreU =
          /pertanian|perkebunan|peternakan|ternak|pendidikan/i.test(
            namaKategoriPreU,
          );
        const checkTanamanU = (cbCheck) => {
          if (isProduksiPreU) return cbCheck(null, []);
          verifikasiTanamanMilikLokasi(lokasi_id, tanamanIds, cbCheck);
        };
        checkTanamanU((errT, invalidTanaman) => {
          if (errT) return res.status(500).json({ error: errT.message });
          if (invalidTanaman && invalidTanaman.length > 0) {
            return res
              .status(400)
              .json({
                error:
                  "Terdapat tanaman yang bukan milik lokasi terpilih: " +
                  invalidTanaman.map((t) => `"${t.nama}"`).join(", ") +
                  ". Kaitkan tanaman itu ke lokasi ini lewat Manajemen Tanaman.",
              });
          }
          ambilNamaKategori(kategori, kategori_id, (namaKategori) => {
            // Kategori produksi tidak memilih lokasi, tapi wajib punya tanaman/ternak:
            // tanpa target, laporan dari "__" tidak punya tujuan.
            if (
              /pertanian|perkebunan/i.test(namaKategori) &&
              tanamanData.length === 0
            ) {
              return res
                .status(400)
                .json({
                  error:
                    "Kategori pertanian wajib memilih minimal satu tanaman.",
                });
            }
            if (
              /peternakan|ternak/i.test(namaKategori) &&
              ternakData.length === 0
            ) {
              return res
                .status(400)
                .json({
                  error:
                    "Kategori peternakan wajib memilih minimal satu ternak.",
                });
            }

            // Lokasi wajib untuk semua kategori; kegiatan bersifat opsional.
            if (!lokasi_id)
              return res.status(400).json({ error: "Lokasi wajib dipilih." });

            db.query(
              `UPDATE activity_schedules SET
               nama_aktivitas=?, kategori=?, kategori_id=?, lokasi_id=?, deskripsi=?, pola_perulangan=?,
               interval_hari=?, tanggal_mulai=?, jam_mulai=?, jam_selesai=?, tanggal_selesai=?,
               penanggung_jawab=?, status=?
             WHERE id=?`,
              [
                nama_aktivitas,
                namaKategori,
                normalisasiIdInt(kategori_id),
                normalisasiIdInt(lokasi_id),
                deskripsiFinalEdit,
                pola_perulangan,
                interval,
                tanggal_mulai,
                jamMulaiFinalEdit,
                jamSelesaiFinalEdit,
                tanggal_selesai || null,
                penanggungJawabString,
                status || "aktif",
                req.params.id,
              ],
              (errUpd) => {
                if (errUpd)
                  return res.status(500).json({ error: errUpd.message });

                // Relasi pivot (tanaman/ternak/kegiatan/santri) harus SELALU ditulis
                // ulang dari isi form. Sebelumnya pemanggilannya hanya berjalan bila
                // ada lokasi + kegiatan, sehingga pada jadwal kategori produksi
                // (lokasi tidak dipilih) pilihan tanaman beserta aksinya justru
                // dibuang diam-diam padahal simpanan dianggap berhasil.
                const kegiatanFinal = normalisasiIdInt(lokasi_id)
                  ? kegiatanIds
                  : [];
                simpanRelasiAktivitas(
                  req.params.id,
                  kegiatanFinal,
                  tanamanData,
                  ternakData,
                  santriIdArray,
                  (errRel) => {
                    if (errRel)
                      console.error(
                        "[PUT /api/jadwal] Gagal simpan relasi:",
                        errRel.message,
                      );
                    sinkronkanTiket();
                  },
                );
              },
            );
          });
        });
      });
    };

    // Sinkronkan tiket: buang tiket pending santri yang dilepas, generate tiket
    // untuk分院 yang baru ditambahkan.
    function sinkronkanTiket() {
      db.query(
        "SELECT penanggung_jawab FROM activity_schedules WHERE id=?",
        [req.params.id],
        (errSel, oldRows) => {
          if (errSel) return res.status(500).json({ error: errSel.message });
          const oldPJ = oldRows.length ? oldRows[0].penanggung_jawab : null;
          const oldPJArray = oldPJ ? String(oldPJ).split(",") : [];
          const asStr = santriIdArray.map(String);
          const removedSantri = oldPJArray.filter((id) => !asStr.includes(id));
          const newSantri = santriIdArray.filter(
            (id) => !oldPJArray.map(String).includes(String(id)),
          );

          if (removedSantri.length > 0) {
            const todayStr = toDateStr(new Date());
            removedSantri.forEach((santriId) => {
              db.query(
                "DELETE FROM activity_tasks WHERE schedule_id=? AND santri_id=? AND status='pending' AND tanggal_tugas >= ?",
                [req.params.id, santriId, todayStr],
                () => {},
              );
            });
          }

          if (newSantri.length > 0) {
            let completed = 0;
            const total = newSantri.length;
            newSantri.forEach((santriId) => {
              db.query(
                "SELECT nama FROM pendaftar_santri WHERE id=?",
                [santriId],
                (e, rows) => {
                  const namaSantri = rows && rows.length ? rows[0].nama : null;
                  const sch = {
                    id: req.params.id,
                    pola_perulangan,
                    interval_hari: interval,
                    tanggal_mulai,
                    penanggung_jawab: santriId,
                  };
                  generateTiketUntukJadwal(sch, namaSantri, () => {
                    completed++;
                    if (completed === total) {
                      res.json({
                        message:
                          "Jadwal berhasil diperbarui dan tiket untuk santri baru sudah digenerate",
                      });
                    }
                  });
                },
              );
            });
          } else {
            res.json({ message: "Jadwal berhasil diperbarui" });
          }
        },
      );
    }

    if (lokasi_id && kegiatanIds.length > 0) {
      verifikasiKegiatanMilikLokasi(
        lokasi_id,
        kegiatanIds,
        (errK, jumlahCocok) => {
          if (errK) return res.status(500).json({ error: errK.message });
          if (jumlahCocok !== kegiatanIds.length) {
            return res
              .status(400)
              .json({
                error:
                  "Terdapat kegiatan yang bukan milik lokasi yang dipilih. Pilih ulang kegiatan untuk lokasi ini.",
              });
          }
          lanjutUpdate();
        },
      );
    } else {
      lanjutUpdate();
    }
  });
});

// DELETE jadwal
app.delete("/api/jadwal/:id", (req, res) => {
  db.query(
    "DELETE FROM activity_schedules WHERE id=?",
    [req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Jadwal dihapus" });
    },
  );
});

// PATCH status jadwal
app.patch("/api/jadwal/:id/status", (req, res) => {
  db.query(
    "UPDATE activity_schedules SET status=? WHERE id=?",
    [req.body.status, req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: `Status diubah ke ${req.body.status}` });
    },
  );
});

// ── NOTIFIKASI ADMIN ─────────────────────────────────────────────────────────
// Pusat notifikasi di panel admin hanya memuat peristiwa dari LUAR panel admin:
// data yang masuk dari website publik (reservasi, pesan/konsultasi, pendaftaran)
// serta tugas yang selesai dikerjakan Santri. Aksi admin sendiri (kirim tugas,
// tambah/ubah data) tidak ikut di sini — cukup tampil sebagai toast — supaya
// daftar notifikasi tidak menumpuk.
//
// Angka "tugas_selesai" sengaja memakai diselesaikan_at, bukan status='selesai',
// karena hanya Santri yang mengisi kolom itu saat mengirim bukti tugas.
app.get("/api/notifikasi/masuk", (req, res) => {
  db.query(
    `SELECT
       (SELECT COUNT(*) FROM reservasi)                                  AS reservasi,
       (SELECT COUNT(*) FROM appointments)                                AS appointment,
       (SELECT COUNT(*) FROM pendaftar_santri)                           AS pendaftar,
       (SELECT COUNT(*) FROM activity_tasks WHERE diselesaikan_at IS NOT NULL) AS tugas_selesai`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const r = (rows && rows[0]) || {};
      res.json({
        reservasi: Number(r.reservasi) || 0,
        appointment: Number(r.appointment) || 0,
        pendaftar: Number(r.pendaftar) || 0,
        tugas_selesai: Number(r.tugas_selesai) || 0,
      });
    },
  );
});

// ── ACTIVITY TASKS ────────────────────────────────────────────────────────────

// GET semua tiket (admin)
app.get("/api/tugas", (req, res) => {
  db.query(
    `SELECT t.*, s.nama_aktivitas, s.kategori, s.pola_perulangan, s.jam_mulai, s.jam_selesai,
            ${jumlahRekanSubquery()} AS jumlah_rekan,
            ${tanamanInfoSubquery()} AS tanaman_info,
            ${ternakInfoSubquery()} AS ternak_info
     FROM activity_tasks t
     JOIN activity_schedules s ON t.schedule_id = s.id
     ORDER BY t.tanggal_tugas DESC`,
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    },
  );
});

// GET tiket milik santri yang login untuk section "Tugas Saya" di dashboard.
// Hanya tiket PENDING (tanpa batas tanggal, supaya tugas yang baru dibuat admin
// langsung terlihat walau tanggalnya masih mendatang).
// Tiket 'selesai'/'dilewati' SENGAJA TIDAK dikembalikan: setelah santri
// menyelesaikan tugas, kartu itu harus hilang dari "Tugas Saya" dan hanya muncul
// di "Riwayat Tugas" (endpoint /api/tugas/saya). Query tanpa filter status
// sebelumnya membuat tugas selesai ikut nangkring di "Tugas Saya".
app.get("/api/tugas/hari-ini", authenticateSantriToken, (req, res) => {
  const santriId = req.user.id;

  db.query(
    `SELECT t.*, s.nama_aktivitas, s.kategori, s.deskripsi, s.jam_mulai, s.jam_selesai,
            ${jumlahRekanSubquery()} AS jumlah_rekan,
            ${tanamanInfoSubquery()} AS tanaman_info,
            ${ternakInfoSubquery()} AS ternak_info
     FROM activity_tasks t
     JOIN activity_schedules s ON t.schedule_id = s.id
     WHERE t.santri_id = ? AND t.status = 'pending'
     ORDER BY t.tanggal_tugas ASC, s.jam_mulai IS NULL, s.jam_mulai ASC, t.id ASC
     LIMIT 10`,
    [santriId],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results || []);
    },
  );
});

// GET semua tugas milik santri (riwayat)
app.get("/api/tugas/saya", authenticateSantriToken, (req, res) => {
  db.query(
    `SELECT t.*, s.nama_aktivitas, s.kategori, s.deskripsi, s.pola_perulangan, s.jam_mulai, s.jam_selesai,
            ${jumlahRekanSubquery()} AS jumlah_rekan,
            ${tanamanInfoSubquery()} AS tanaman_info,
            ${ternakInfoSubquery()} AS ternak_info
     FROM activity_tasks t
     JOIN activity_schedules s ON t.schedule_id = s.id
     WHERE t.santri_id = ?
     ORDER BY t.tanggal_tugas DESC`,
    [req.user.id],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    },
  );
});

// GET tugas mendatang
app.get("/api/tugas/mendatang", authenticateSantriToken, (req, res) => {
  const todayStr = toDateStr(new Date());
  db.query(
    `SELECT t.*, s.nama_aktivitas, s.kategori, s.deskripsi, s.jam_mulai, s.jam_selesai,
            ${jumlahRekanSubquery()} AS jumlah_rekan,
            ${tanamanInfoSubquery()} AS tanaman_info,
            ${ternakInfoSubquery()} AS ternak_info
     FROM activity_tasks t
     JOIN activity_schedules s ON t.schedule_id = s.id
     WHERE t.santri_id = ? AND t.tanggal_tugas > ? AND t.status = 'pending'
     ORDER BY t.tanggal_tugas ASC LIMIT 10`,
    [req.user.id, todayStr],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    },
  );
});

// GET detail satu tiket tugas milik santri yang login.
// Dipakai halaman tanaman/ternak untuk mode "Kerjakan" (?tugas=<id>).
app.get("/api/tugas/:id", authenticateSantriToken, (req, res) => {
  const taskId = parseInt(req.params.id, 10);
  if (!Number.isFinite(taskId)) {
    return res.status(400).json({ message: "ID tugas tidak valid" });
  }
  db.query(
    `SELECT t.*, s.nama_aktivitas, s.kategori, s.deskripsi, s.pola_perulangan,
            s.jam_mulai, s.jam_selesai,
            ${jumlahRekanSubquery()} AS jumlah_rekan,
            ${tanamanInfoSubquery()} AS tanaman_info,
            ${ternakInfoSubquery()} AS ternak_info
     FROM activity_tasks t
     JOIN activity_schedules s ON t.schedule_id = s.id
     WHERE t.id = ? AND t.santri_id = ?`,
    [taskId, req.user.id],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!results.length)
        return res.status(404).json({ message: "Tugas tidak ditemukan" });
      res.json(results[0]);
    },
  );
});

// POST tiket manual (admin)
app.post("/api/tugas", (req, res) => {
  const { schedule_id, santri_id, nama_santri, tanggal_tugas } = req.body;
  db.query(
    `INSERT IGNORE INTO activity_tasks (schedule_id, santri_id, nama_santri, tanggal_tugas)
     VALUES (?, ?, ?, ?)`,
    [schedule_id, santri_id || null, nama_santri || null, tanggal_tugas],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Tiket tugas dibuat", id: result.insertId });
    },
  );
});

// PATCH tandai selesai (santri) — pakai uploadDisk agar foto langsung tersimpan
app.patch(
  "/api/tugas/:id/selesai",
  authenticateSantriToken,
  uploadDisk.single("foto_bukti"),
  (req, res) => {
    handleTugasSelesai(req, res);
  },
);

// PUT alias untuk PATCH /selesai — fallback jika CORS PATCH belum aktif
app.put(
  "/api/tugas/:id/selesai",
  authenticateSantriToken,
  uploadDisk.single("foto_bukti"),
  (req, res) => {
    handleTugasSelesai(req, res);
  },
);

function handleTugasSelesai(req, res) {
  const santriId = req.user.id;
  const {
    catatan,
    tanaman_id: tanamanIdBody,
    aksi: aksiBody,
    ternak_id: ternakIdBody,
    master_aksi_id: masterAksiIdBody,
    nilai_angka: nilaiAngkaBody,
  } = req.body;
  const fotoBukti = req.file ? req.file.filename : null;

  // Fallback target tanaman: dikirim dari halaman detail tanaman saat Santri
  // mengerjakan tugas. Tanpa ini, jadwal yang belum punya baris di
  // aktivitas_tanaman tidak punya tanaman tujuan sehingga riwayatnya hilang.
  const tanamanFallback = parseInt(tanamanIdBody, 10);
  const tanamanIdValid =
    Number.isInteger(tanamanFallback) && tanamanFallback > 0
      ? tanamanFallback
      : null;
  const aksiFallback = String(aksiBody || "")
    .trim()
    .toLowerCase();

  // Fallback target ternak + nominal (mis. "Konfirmasi Ayam Mati"): dikirim dari
  // halaman detail ternak. Nominal dipakai untuk mencatat nilai_angka pada
  // riwayat dan mengurangi total / menambah total_mati ternak.
  const ternakFallback = parseInt(ternakIdBody, 10);
  const ternakIdValid =
    Number.isInteger(ternakFallback) && ternakFallback > 0
      ? ternakFallback
      : null;
  const masterAksiFallback = parseInt(masterAksiIdBody, 10);
  const masterAksiIdValid =
    Number.isInteger(masterAksiFallback) && masterAksiFallback > 0
      ? masterAksiFallback
      : null;
  const nilaiAngkaFallback = parseInt(nilaiAngkaBody, 10);

  console.log(
    `[tugas/${req.params.id}/selesai] santriId=${santriId} foto=${fotoBukti} catatan=${catatan} tanaman=${tanamanIdValid} aksi=${aksiFallback} ternak=${ternakIdValid} masterAksi=${masterAksiIdValid} nilai=${nilaiAngkaFallback}`,
  );

  db.query(
    "SELECT * FROM activity_tasks WHERE id=?",
    [req.params.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows.length)
        return res.status(404).json({ message: "Tiket tidak ditemukan" });

      // Izinkan jika santri_id match ATAU santri_id null (tiket belum di-assign)
      if (rows[0].santri_id !== null && rows[0].santri_id !== santriId) {
        return res.status(403).json({ message: "Bukan tugas Anda" });
      }
      if (rows[0].status === "selesai") {
        return res
          .status(400)
          .json({ message: "Tugas sudah ditandai selesai" });
      }

      db.query(
        `UPDATE activity_tasks
       SET status='selesai', catatan=?, foto_bukti=?, diselesaikan_at=NOW(),
           santri_id = COALESCE(santri_id, ?)
       WHERE id=?`,
        [catatan || null, fotoBukti, santriId, req.params.id],
        (err) => {
          if (err) {
            console.error("[selesai] DB error:", err.message);
            return res.status(500).json({ error: err.message });
          }
          console.log(`[tugas/${req.params.id}/selesai] ✅ Berhasil`);

          // Auto-catat riwayat perawatan tanaman & ternak (SATU sumber):
          // - jadwal Pertanian/Perkebunan → log_perawatan (per aksi siram/pupuk/panen)
          // - jadwal Peternakan → log_perawatan_ternak (per aksi dari master_aksi_ternak)
          const scheduleId = rows[0].schedule_id;
          const namaPerawat = req.user.nama || req.user.username || "Santri";

          const catatTanaman = (cbDone) => {
            db.query(
              `SELECT at.tanaman_id, at.aksi
               FROM aktivitas_tanaman at
              WHERE at.aktivitas_id = ? AND at.aksi IS NOT NULL`,
              [scheduleId],
              (errPlants, plantRows) => {
                if (errPlants) return cbDone(errPlants);

                // Target tanaman digabung dengan fallback dari halaman detail,
                // lalu di-de-duplicate per tanaman agar tidak dobel.
                const targets = new Map();
                (plantRows || []).forEach((pr) => {
                  targets.set(pr.tanaman_id, pr.aksi);
                });
                if (tanamanIdValid && !targets.has(tanamanIdValid)) {
                  targets.set(
                    tanamanIdValid,
                    ["siram", "pupuk", "panen"].includes(aksiFallback)
                      ? aksiFallback
                      : "siram",
                  );
                }

                const list = [...targets.entries()].map(
                  ([tanaman_id, aksi]) => ({ tanaman_id, aksi }),
                );
                let inserted = 0;
                if (!list.length) return cbDone(null, 0);
                list.forEach((pr) => {
                  db.query(
                    `INSERT INTO log_perawatan
                     (tanaman_id, jadwal_id, santri_id, jenis_tindakan, laporan_singkat, gambar, nama_perawat, role_perawat, waktu_tindakan)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 'Santri', NOW())`,
                    [
                      pr.tanaman_id,
                      scheduleId,
                      req.user.id,
                      pr.aksi,
                      catatan || null,
                      fotoBukti,
                      namaPerawat,
                    ],
                    (errLog) => {
                      if (errLog)
                        console.error(
                          "[selesai] Gagal catat riwayat tanaman:",
                          errLog.message,
                        );
                      inserted++;
                      if (inserted === list.length) cbDone(null, list.length);
                    },
                  );
                });
              },
            );
          };

          // Validasi nominal untuk aksi yang butuh angka (mis. ayam mati):
          // pastikan aksi memang butuh_input_angka dan nilainya wajar.
          const siapkanNilaiTernak = (cb) => {
            if (!ternakIdValid || !masterAksiIdValid) return cb(null, 0);
            db.query(
              `SELECT m.butuh_input_angka, m.label_input, t.total
               FROM master_aksi_ternak m
               JOIN ternak t ON t.id = ? AND t.jenis_ternak_id = m.jenis_ternak_id
              WHERE m.id = ? AND m.aktif = 1`,
              [ternakIdValid, masterAksiIdValid],
              (errV, vRows) => {
                if (errV) return cb(errV);
                if (!vRows || !vRows.length || !vRows[0].butuh_input_angka)
                  return cb(null, 0);
                const angka = nilaiAngkaFallback;
                if (!(angka > 0)) {
                  return cb(
                    new Error(
                      vRows[0].label_input ||
                        "Jumlah wajib diisi dengan angka positif.",
                    ),
                  );
                }
                if (angka > (Number(vRows[0].total) || 0)) {
                  return cb(
                    new Error(
                      `Jumlah melebihi total ternak saat ini (${vRows[0].total}).`,
                    ),
                  );
                }
                cb(null, angka);
              },
            );
          };

          const catatTernak = (nilaiAngka, cbDone) => {
            db.query(
              `SELECT atr.ternak_id, atr.master_aksi_id
               FROM aktivitas_ternak atr
              WHERE atr.aktivitas_id = ? AND atr.master_aksi_id IS NOT NULL`,
              [scheduleId],
              (errTernaks, ternakRows) => {
                if (errTernaks) return cbDone(errTernaks);

                // Target dari jadwal + fallback dari halaman detail ternak
                // (de-duplikasi per master_aksi_id).
                const targets = new Map();
                (ternakRows || []).forEach((tr) => {
                  targets.set(Number(tr.master_aksi_id), {
                    ternak_id: tr.ternak_id,
                    master_aksi_id: tr.master_aksi_id,
                  });
                });
                if (
                  ternakIdValid &&
                  masterAksiIdValid &&
                  !targets.has(masterAksiIdValid)
                ) {
                  targets.set(masterAksiIdValid, {
                    ternak_id: ternakIdValid,
                    master_aksi_id: masterAksiIdValid,
                  });
                }

                let list = [...targets.values()];
                if (!list.length) return cbDone(null, 0);

                // Aksi butuh nominal (mis. "Konfirmasi Ayam Mati") hanya dicatat
                // bila santri benar-benar mengisi nominalnya.
                const idsButuhAngka = list.map((tr) =>
                  Number(tr.master_aksi_id),
                );
                db.query(
                  `SELECT id, butuh_input_angka FROM master_aksi_ternak WHERE id IN (?)`,
                  [idsButuhAngka],
                  (errM, mRows) => {
                    if (errM) return cbDone(errM);
                    const butuhAngka = new Map(
                      (mRows || []).map((m) => [
                        Number(m.id),
                        !!m.butuh_input_angka,
                      ]),
                    );
                    list = list.filter((tr) => {
                      if (!butuhAngka.get(Number(tr.master_aksi_id)))
                        return true;
                      return (
                        Number(tr.master_aksi_id) === masterAksiIdValid &&
                        nilaiAngka > 0
                      );
                    });
                    if (!list.length) return cbDone(null, 0);

                    let inserted = 0;
                    let ternakUpdateId = null;
                    let nilaiTersimpan = 0;

                    list.forEach((tr) => {
                      const isTargetAngka =
                        Number(tr.master_aksi_id) === masterAksiIdValid &&
                        nilaiAngka > 0;
                      const nilaiLog = isTargetAngka ? nilaiAngka : null;
                      if (isTargetAngka) {
                        ternakUpdateId = tr.ternak_id;
                        nilaiTersimpan = nilaiLog;
                      }
                      db.query(
                        `INSERT INTO log_perawatan_ternak
                         (ternak_id, master_aksi_id, jadwal_id, aktivitas_id, catatan, foto, nilai_angka, diinput_oleh, nama_perawat, role_perawat)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Santri')`,
                        [
                          tr.ternak_id,
                          tr.master_aksi_id,
                          scheduleId,
                          scheduleId,
                          catatan || null,
                          fotoBukti,
                          nilaiLog,
                          req.user.id,
                          namaPerawat,
                        ],
                        (errLog) => {
                          if (errLog)
                            console.error(
                              "[selesai] Gagal catat riwayat ternak:",
                              errLog.message,
                            );
                          inserted++;
                          if (inserted !== list.length) return;

                          // Aksi angka → kurangi total & tambah total_mati ternak.
                          if (nilaiTersimpan > 0 && ternakUpdateId) {
                            db.query(
                              `UPDATE ternak SET total = GREATEST(0, total - ?), total_mati = IFNULL(total_mati, 0) + ? WHERE id = ?`,
                              [nilaiTersimpan, nilaiTersimpan, ternakUpdateId],
                              (errUpd) => {
                                if (errUpd)
                                  console.error(
                                    "[selesai] Gagal update total ternak:",
                                    errUpd.message,
                                  );
                                cbDone(null, list.length, nilaiTersimpan);
                              },
                            );
                          } else {
                            cbDone(null, list.length, 0);
                          }
                        },
                      );
                    });
                  },
                );
              },
            );
          };

          let nTanaman = 0,
            nTernak = 0,
            nNilai = 0;
          catatTanaman((errP, jmlP) => {
            if (errP) return res.status(500).json({ error: errP.message });
            nTanaman = jmlP;
            siapkanNilaiTernak((errV, nilaiDipakai) => {
              if (errV) return res.status(400).json({ error: errV.message });
              catatTernak(nilaiDipakai, (errT, jmlT, nilaiT) => {
                if (errT) return res.status(500).json({ error: errT.message });
                nTernak = jmlT;
                nNilai = nilaiT || 0;
                res.json({
                  message: "Tugas berhasil ditandai selesai",
                  foto_bukti: fotoBukti,
                  riwayat_dicatat: nTanaman + nTernak,
                  tanaman_dicatat: nTanaman,
                  ternak_dicatat: nTernak,
                  nilai_angka: nNilai,
                });
              });
            });
          });
        },
      );
    },
  );
}

// PATCH status tiket (admin)
app.patch("/api/tugas/:id/status", (req, res) => {
  db.query(
    "UPDATE activity_tasks SET status=? WHERE id=?",
    [req.body.status, req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: `Status tiket diubah ke ${req.body.status}` });
    },
  );
});

// DELETE tiket
app.delete("/api/tugas/:id", (req, res) => {
  db.query("DELETE FROM activity_tasks WHERE id=?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Tiket dihapus" });
  });
});

// ── ENDPOINT KATEGORI ──────────────────────────────────────────────────
// GET semua kategori
app.get("/api/kategori", (req, res) => {
  db.query(
    "SELECT * FROM kategori WHERE aktif = 1 ORDER BY nama",
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    },
  );
});

// POST tambah kategori
app.post("/api/kategori", (req, res) => {
  const { nama } = req.body;
  if (!nama) return res.status(400).json({ error: "Nama kategori diperlukan" });

  const namaNormalized = nama.trim();

  db.query(
    "SELECT id FROM kategori WHERE LOWER(nama) = LOWER(?)",
    [namaNormalized],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (results.length > 0)
        return res.status(400).json({ error: "Nama kategori sudah ada" });

      db.query(
        "INSERT INTO kategori (nama) VALUES (?)",
        [namaNormalized],
        (err, result) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ id: result.insertId, nama: namaNormalized, aktif: 1 });
        },
      );
    },
  );
});

// PUT update kategori
app.put("/api/kategori/:id", (req, res) => {
  const { nama } = req.body;
  if (!nama) return res.status(400).json({ error: "Nama kategori diperlukan" });

  const namaNormalized = nama.trim();

  db.query(
    "SELECT id FROM kategori WHERE LOWER(nama) = LOWER(?) AND id != ?",
    [namaNormalized, req.params.id],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (results.length > 0)
        return res.status(400).json({ error: "Nama kategori sudah ada" });

      db.query(
        "UPDATE kategori SET nama = ? WHERE id = ?",
        [namaNormalized, req.params.id],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Kategori diperbarui" });
        },
      );
    },
  );
});

// DELETE/hapus kategori (soft delete)
app.delete("/api/kategori/:id", (req, res) => {
  db.query(
    "SELECT COUNT(*) as count FROM activity_schedules WHERE kategori_id = ?",
    [req.params.id],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (results[0].count > 0) {
        return res
          .status(400)
          .json({ error: "Kategori masih digunakan oleh jadwal aktivitas" });
      }

      db.query(
        "UPDATE kategori SET aktif = 0 WHERE id = ?",
        [req.params.id],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Kategori dinonaktifkan" });
        },
      );
    },
  );
});

// ── ENDPOINT LOKASI ───────────────────────────────────────────────────
// GET semua lokasi
app.get("/api/lokasi", (req, res) => {
  db.query(
    `SELECT l.*,
            (SELECT COUNT(*) FROM kegiatan_lokasi k WHERE k.lokasi_id = l.id AND k.aktif = 1) AS jumlah_kegiatan
     FROM lokasi l
     WHERE l.aktif = 1
     ORDER BY l.nama`,
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    },
  );
});

// GET kegiatan milik satu lokasi (untuk form jadwal) — 404 bila lokasi tidak ditemukan
app.get("/api/lokasi/:id/kegiatan", (req, res) => {
  const lokasiId = req.params.id;
  db.query(
    "SELECT id FROM lokasi WHERE id = ?",
    [lokasiId],
    (err, lokasiResults) => {
      if (err) return res.status(500).json({ error: err.message });
      if (lokasiResults.length === 0)
        return res.status(404).json({ error: "Lokasi tidak ditemukan" });
      db.query(
        "SELECT id, nama FROM kegiatan_lokasi WHERE lokasi_id = ? AND aktif = 1 ORDER BY nama ASC",
        [lokasiId],
        (err2, kegiatanResults) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json(kegiatanResults);
        },
      );
    },
  );
});

// GET detail lokasi dengan tanaman, kegiatan, dan aktivitas
app.get("/api/lokasi/:id", (req, res) => {
  const lokasiId = req.params.id;

  db.query(
    "SELECT * FROM lokasi WHERE id = ?",
    [lokasiId],
    (err, lokasiResults) => {
      if (err) return res.status(500).json({ error: err.message });
      if (lokasiResults.length === 0)
        return res.status(404).json({ error: "Lokasi tidak ditemukan" });

      const lokasi = lokasiResults[0];

      // Ambil kegiatan di lokasi ini
      db.query(
        "SELECT * FROM kegiatan_lokasi WHERE lokasi_id = ? AND aktif = 1 ORDER BY nama",
        [lokasiId],
        (err, kegiatanResults) => {
          if (err) return res.status(500).json({ error: err.message });

          // Ambil tanaman di lokasi ini
          db.query(
            "SELECT id, nama, jenis, deskripsi, gambar FROM tanaman WHERE lokasi_id = ? ORDER BY nama",
            [lokasiId],
            (err, tanamanResults) => {
              if (err) return res.status(500).json({ error: err.message });

              // Ambil aktivitas di lokasi ini
              db.query(
                "SELECT * FROM activity_schedules WHERE lokasi_id = ? ORDER BY tanggal_mulai DESC",
                [lokasiId],
                (err, aktivitasResults) => {
                  if (err) return res.status(500).json({ error: err.message });

                  res.json({
                    ...lokasi,
                    kegiatan: kegiatanResults,
                    tanaman: tanamanResults,
                    aktivitas: aktivitasResults,
                  });
                },
              );
            },
          );
        },
      );
    },
  );
});

// POST tambah satu kegiatan untuk lokasi (dipakai form jadwal & manajemen lokasi)
// Idempoten: bila sudah ada dengan nama sama (per lokasi, tak bedakan besar-kecil huruf) → reaktivasi & kembalikan id yang sama
app.post("/api/lokasi/:id/kegiatan", (req, res) => {
  const lokasiId = req.params.id;
  const nama = String(req.body.nama || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!nama)
    return res.status(400).json({ error: "Nama kegiatan wajib diisi" });

  db.query(
    "SELECT id FROM lokasi WHERE id = ?",
    [lokasiId],
    (err, lokasiRows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (lokasiRows.length === 0)
        return res.status(404).json({ error: "Lokasi tidak ditemukan" });

      db.query(
        "SELECT id, aktif FROM kegiatan_lokasi WHERE lokasi_id = ? AND LOWER(nama) = LOWER(?)",
        [lokasiId, nama],
        (err2, rows) => {
          if (err2) return res.status(500).json({ error: err2.message });
          if (rows.length > 0) {
            const existing = rows[0];
            if (existing.aktif !== 1) {
              db.query(
                "UPDATE kegiatan_lokasi SET aktif = 1 WHERE id = ?",
                [existing.id],
                (err3) => {
                  if (err3)
                    return res.status(500).json({ error: err3.message });
                  res.json({
                    id: existing.id,
                    lokasi_id: parseInt(lokasiId, 10),
                    nama,
                    aktif: 1,
                  });
                },
              );
            } else {
              res.json({
                id: existing.id,
                lokasi_id: parseInt(lokasiId, 10),
                nama,
                aktif: 1,
              });
            }
          } else {
            db.query(
              "INSERT INTO kegiatan_lokasi (lokasi_id, nama) VALUES (?, ?)",
              [lokasiId, nama],
              (err4, result) => {
                if (err4) return res.status(500).json({ error: err4.message });
                res.json({
                  id: result.insertId,
                  lokasi_id: parseInt(lokasiId, 10),
                  nama,
                  aktif: 1,
                });
              },
            );
          }
        },
      );
    },
  );
});

// Normalisasi daftar nama kegiatan (trim, buang spasi berlebih, buang duplikat)
function normalizeKegiatanList(kegiatan) {
  if (!Array.isArray(kegiatan)) return [];
  const result = [];
  const seen = new Set();
  kegiatan.forEach((k) => {
    if (typeof k !== "string") return;
    const normalized = k.trim().replace(/\s+/g, " ");
    if (!normalized || seen.has(normalized.toLowerCase())) return;
    seen.add(normalized.toLowerCase());
    result.push(normalized);
  });
  return result;
}

// Insert kegiatan baru untuk lokasi di dalam satu transaksi (skip jika sudah ada)
function saveKegiatanLokasi(tx, lokasiId, kegiatan, done) {
  const list = normalizeKegiatanList(kegiatan);
  if (list.length === 0) return done(null);
  let i = 0;
  const insert = () => {
    if (i >= list.length) return done(null);
    const namaKegiatan = list[i++];
    tx.query(
      "SELECT id FROM kegiatan_lokasi WHERE lokasi_id = ? AND LOWER(nama) = LOWER(?)",
      [lokasiId, namaKegiatan],
      (err, rows) => {
        if (err) return done(err);
        if (rows.length > 0) {
          tx.query(
            "UPDATE kegiatan_lokasi SET aktif = 1 WHERE id = ?",
            [rows[0].id],
            (err2) => {
              if (err2) return done(err2);
              insert();
            },
          );
          return;
        }
        tx.query(
          "INSERT INTO kegiatan_lokasi (lokasi_id, nama) VALUES (?, ?)",
          [lokasiId, namaKegiatan],
          (err3) => {
            if (err3) return done(err3);
            insert();
          },
        );
      },
    );
  };
  insert();
}

// Ganti seluruh daftar kegiatan lokasi di dalam satu transaksi
function replaceKegiatanLokasi(tx, lokasiId, kegiatan, done) {
  tx.query(
    "UPDATE kegiatan_lokasi SET aktif = 0 WHERE lokasi_id = ?",
    [lokasiId],
    (err) => {
      if (err) return done(err);
      saveKegiatanLokasi(tx, lokasiId, kegiatan, done);
    },
  );
}

// POST tambah lokasi (+ daftar kegiatan dalam satu transaksi)
app.post("/api/lokasi", (req, res) => {
  const { nama, keterangan, kegiatan } = req.body;
  if (!nama) return res.status(400).json({ error: "Nama lokasi diperlukan" });

  const namaNormalized = nama.trim().replace(/\s+/g, " ");

  // Pool tidak punya beginTransaction/commit/rollback — ambil satu koneksi dulu.
  db.getConnection((connErr, conn) => {
    if (connErr) return res.status(500).json({ error: connErr.message });

    const batal = (code, payload) =>
      conn.rollback(() => {
        conn.release();
        res.status(code).json(payload);
      });

    conn.beginTransaction((err) => {
      if (err) {
        conn.release();
        return res.status(500).json({ error: err.message });
      }

      conn.query(
        "SELECT id, aktif FROM lokasi WHERE LOWER(nama) = LOWER(?)",
        [namaNormalized],
        (err, results) => {
          if (err) return batal(500, { error: err.message });

          const sudahAktif = results.find((r) => Number(r.aktif) === 1);
          if (sudahAktif) return batal(400, { error: "Nama lokasi sudah ada" });

          // Bila ada baris nonaktif dengan nama sama → reaktivasi, jangan gagal.
          const nonaktif = results[0];
          if (nonaktif) {
            conn.query(
              "UPDATE lokasi SET aktif = 1, keterangan = ? WHERE id = ?",
              [keterangan || null, nonaktif.id],
              (errUp) => {
                if (errUp) return batal(500, { error: errUp.message });
                saveKegiatanLokasi(conn, nonaktif.id, kegiatan, (err2) => {
                  if (err2) return batal(500, { error: err2.message });
                  conn.commit((err3) => {
                    if (err3) return batal(500, { error: err3.message });
                    conn.release();
                    res.json({
                      id: nonaktif.id,
                      nama: namaNormalized,
                      keterangan,
                      aktif: 1,
                    });
                  });
                });
              },
            );
            return;
          }

          conn.query(
            "INSERT INTO lokasi (nama, keterangan) VALUES (?, ?)",
            [namaNormalized, keterangan || null],
            (err, result) => {
              if (err) return batal(500, { error: err.message });
              const lokasiId = result.insertId;

              saveKegiatanLokasi(conn, lokasiId, kegiatan, (err2) => {
                if (err2) return batal(500, { error: err2.message });
                conn.commit((err3) => {
                  if (err3) return batal(500, { error: err3.message });
                  conn.release();
                  res.json({
                    id: lokasiId,
                    nama: namaNormalized,
                    keterangan,
                    aktif: 1,
                  });
                });
              });
            },
          );
        },
      );
    });
  });
});

// PUT update lokasi (+ mengganti daftar kegiatan dalam satu transaksi bila dikirim)
app.put("/api/lokasi/:id", (req, res) => {
  const { nama, keterangan, kegiatan } = req.body;
  if (!nama) return res.status(400).json({ error: "Nama lokasi diperlukan" });

  const namaNormalized = nama.trim().replace(/\s+/g, " ");

  // Pool tidak punya beginTransaction/commit/rollback — ambil satu koneksi dulu.
  db.getConnection((connErr, conn) => {
    if (connErr) return res.status(500).json({ error: connErr.message });

    const batal = (code, payload) =>
      conn.rollback(() => {
        conn.release();
        res.status(code).json(payload);
      });

    conn.beginTransaction((err) => {
      if (err) {
        conn.release();
        return res.status(500).json({ error: err.message });
      }

      conn.query(
        "SELECT id FROM lokasi WHERE LOWER(nama) = LOWER(?) AND id != ? AND aktif = 1",
        [namaNormalized, req.params.id],
        (err, results) => {
          if (err) return batal(500, { error: err.message });
          if (results.length > 0)
            return batal(400, { error: "Nama lokasi sudah ada" });

          conn.query(
            "UPDATE lokasi SET nama = ?, keterangan = ? WHERE id = ?",
            [namaNormalized, keterangan || null, req.params.id],
            (err) => {
              if (err) return batal(500, { error: err.message });

              if (!Array.isArray(kegiatan)) {
                return conn.commit((err2) => {
                  if (err2) return batal(500, { error: err2.message });
                  conn.release();
                  res.json({ message: "Lokasi diperbarui" });
                });
              }

              replaceKegiatanLokasi(conn, req.params.id, kegiatan, (err3) => {
                if (err3) return batal(500, { error: err3.message });
                conn.commit((err4) => {
                  if (err4) return batal(500, { error: err4.message });
                  conn.release();
                  res.json({ message: "Lokasi diperbarui" });
                });
              });
            },
          );
        },
      );
    });
  });
});

// DELETE/hapus lokasi
app.delete("/api/lokasi/:id", (req, res) => {
  const lokasiId = req.params.id;

  db.query(
    "SELECT COUNT(*) as count FROM tanaman WHERE lokasi_id = ?",
    [lokasiId],
    (err, tanamanResults) => {
      if (err) return res.status(500).json({ error: err.message });
      if (tanamanResults[0].count > 0) {
        return res
          .status(400)
          .json({
            error: `Lokasi masih digunakan oleh ${tanamanResults[0].count} tanaman`,
          });
      }

      db.query(
        "SELECT COUNT(*) as count FROM activity_schedules WHERE lokasi_id = ?",
        [lokasiId],
        (err, aktivitasResults) => {
          if (err) return res.status(500).json({ error: err.message });
          if (aktivitasResults[0].count > 0) {
            return res
              .status(400)
              .json({
                error: `Lokasi masih digunakan oleh ${aktivitasResults[0].count} aktivitas`,
              });
          }

          db.query(
            "UPDATE lokasi SET aktif = 0 WHERE id = ?",
            [lokasiId],
            (err) => {
              if (err) return res.status(500).json({ error: err.message });
              res.json({ message: "Lokasi dinonaktifkan" });
            },
          );
        },
      );
    },
  );
});

// ── ENDPOINT KEGIATAN LOKASI ───────────────────────────────────────────────────
// GET kegiatan per lokasi
app.get("/api/kegiatan-lokasi", (req, res) => {
  const { lokasi_id } = req.query;
  let query =
    "SELECT kl.*, l.nama as nama_lokasi FROM kegiatan_lokasi kl JOIN lokasi l ON kl.lokasi_id = l.id WHERE kl.aktif = 1";
  const params = [];

  if (lokasi_id) {
    query += " AND kl.lokasi_id = ?";
    params.push(lokasi_id);
  }

  query += " ORDER BY l.nama, kl.nama";

  db.query(query, params, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// POST tambah kegiatan lokasi
app.post("/api/kegiatan-lokasi", (req, res) => {
  const { lokasi_id, nama } = req.body;
  if (!lokasi_id || !nama)
    return res
      .status(400)
      .json({ error: "Lokasi ID dan nama kegiatan diperlukan" });

  const namaNormalized = nama.trim();

  db.query(
    "SELECT id FROM lokasi WHERE id = ? AND aktif = 1",
    [lokasi_id],
    (err, lokasiResults) => {
      if (err) return res.status(500).json({ error: err.message });
      if (lokasiResults.length === 0)
        return res
          .status(400)
          .json({ error: "Lokasi tidak ditemukan atau tidak aktif" });

      db.query(
        "SELECT id FROM kegiatan_lokasi WHERE lokasi_id = ? AND LOWER(nama) = LOWER(?)",
        [lokasi_id, namaNormalized],
        (err, results) => {
          if (err) return res.status(500).json({ error: err.message });
          if (results.length > 0)
            return res
              .status(400)
              .json({ error: "Kegiatan dengan nama ini sudah ada di lokasi" });

          db.query(
            "INSERT INTO kegiatan_lokasi (lokasi_id, nama) VALUES (?, ?)",
            [lokasi_id, namaNormalized],
            (err, result) => {
              if (err) return res.status(500).json({ error: err.message });
              res.json({
                id: result.insertId,
                lokasi_id,  
                nama: namaNormalized,
                aktif: 1,
              });
            },
          );
        },
      );
    },
  );
});

// PUT update kegiatan lokasi
app.put("/api/kegiatan-lokasi/:id", (req, res) => {
  const { nama } = req.body;
  if (!nama) return res.status(400).json({ error: "Nama kegiatan diperlukan" });

  const namaNormalized = nama.trim();

  db.query(
    "SELECT lokasi_id FROM kegiatan_lokasi WHERE id = ?",
    [req.params.id],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (results.length === 0)
        return res.status(404).json({ error: "Kegiatan tidak ditemukan" });

      const lokasi_id = results[0].lokasi_id;

      db.query(
        "SELECT id FROM kegiatan_lokasi WHERE lokasi_id = ? AND LOWER(nama) = LOWER(?) AND id != ?",
        [lokasi_id, namaNormalized, req.params.id],
        (err, checkResults) => {
          if (err) return res.status(500).json({ error: err.message });
          if (checkResults.length > 0)
            return res
              .status(400)
              .json({ error: "Kegiatan dengan nama ini sudah ada di lokasi" });

          db.query(
            "UPDATE kegiatan_lokasi SET nama = ? WHERE id = ?",
            [namaNormalized, req.params.id],
            (err) => {
              if (err) return res.status(500).json({ error: err.message });
              res.json({ message: "Kegiatan diperbarui" });
            },
          );
        },
      );
    },
  );
});

// DELETE/hapus kegiatan lokasi
app.delete("/api/kegiatan-lokasi/:id", (req, res) => {
  db.query(
    "UPDATE kegiatan_lokasi SET aktif = 0 WHERE id = ?",
    [req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Kegiatan dinonaktifkan" });
    },
  );
});

// ── ENDPOINT SANTRI UNTUK PEMILIH ───────────────────────────────────────────────
// GET santri untuk pemilih (hanya status diterima)
app.get("/api/santri-pemilih", (req, res) => {
  const { kelas, kamar } = req.query;
  // `role` ikut diambil untuk penanda peran di daftar penerima tugas.
  let query =
    'SELECT id, nama, username, role, kelas, kamar FROM pendaftar_santri WHERE status_pendaftaran = "Diterima"';
  const params = [];

  if (kelas) {
    query += " AND kelas = ?";
    params.push(kelas);
  }

  if (kamar) {
    query += " AND kamar = ?";
    params.push(kamar);
  }

  query += " ORDER BY nama";

  db.query(query, params, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// Trigger manual generate tiket
app.post("/api/jadwal/generate-tiket", (req, res) => {
  generateTiketHarian();
  res.json({ message: "Generate tiket dijalankan untuk hari ini" });
});

// Regenerate tiket untuk satu jadwal spesifik (fix jadwal lama yang tiketnya belum ada)
app.post("/api/jadwal/:id/regenerate", (req, res) => {
  db.query(
    `SELECT s.*, p.nama AS nama_pj
     FROM activity_schedules s
     LEFT JOIN pendaftar_santri p ON s.penanggung_jawab = p.id
     WHERE s.id = ?`,
    [req.params.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows.length)
        return res.status(404).json({ message: "Jadwal tidak ditemukan" });

      const sch = rows[0];
      generateTiketUntukJadwal(sch, sch.nama_pj, () => {
        res.json({
          message: `Tiket berhasil digenerate ulang untuk jadwal "${sch.nama_aktivitas}"`,
        });
      });
    },
  );
});

// Menyalakan Server
const PORT = process.env.PORT || 5000;

const canonicalBackend = require(
  path.resolve(__dirname, "../alfilaha-react/server-update.cjs"),
);
app.use(canonicalBackend.app);

// Error handler JSON — ubah error Multer (ukuran/tipe file) jadi respons JSON yang jelas
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const pesan =
      err.code === "LIMIT_FILE_SIZE"
        ? "Ukuran foto maksimal 5 MB"
        : `Gagal mengunggah file: ${err.message}`;
    return res.status(400).json({ error: pesan });
  }
  if (err && err.message) {
    return res.status(400).json({ error: err.message });
  }
  console.error("[Error handler]", err);
  res.status(500).json({ error: "Terjadi kesalahan server" });
});

// Jaring pengaman terakhir: log error tak tertangani tanpa mematikan server.
process.on("uncaughtException", (err) => {
  console.error(
    "❌ [uncaughtException]",
    err && (err.stack || err.message || err),
  );
});
process.on("unhandledRejection", (reason) => {
  console.error("❌ [unhandledRejection]", reason);
});

app.listen(PORT, () => {
  console.log(`🚀 Server Backend berjalan di http://localhost:${PORT}`);
});
