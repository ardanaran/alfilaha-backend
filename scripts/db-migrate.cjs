require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const { execFileSync } = require('child_process');

const MIGRATION_VERSION = '20260925_consolidated';
const LOCK_NAME = 'alfilaha_schema_migrations';

const coreSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(100) NOT NULL PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS pendaftar_santri (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    nama_lengkap VARCHAR(100),
    role VARCHAR(50) DEFAULT 'user'
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS tanaman (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama VARCHAR(255) NOT NULL,
    jenis VARCHAR(100),
    lokasi VARCHAR(255),
    deskripsi TEXT,
    gambar VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS kelas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama VARCHAR(255) NOT NULL,
    tahun_ajaran VARCHAR(100),
    wali_kelas VARCHAR(255),
    deskripsi TEXT,
    foto VARCHAR(255),
    jumlah_santri INT NOT NULL DEFAULT 0,
    status ENUM('draft', 'dipublikasikan') DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

async function runScript(relativePath) {
  const scriptPath = require('path').resolve(__dirname, relativePath);
  execFileSync(process.execPath, [scriptPath], { stdio: 'inherit', env: process.env });
}

async function ensureAdminFromEnv() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'db_alfilaha',
  });
  try {
    const username = String(process.env.ADMIN_USERNAME || '').trim();
    const password = String(process.env.ADMIN_PASSWORD || '');
    const namaLengkap = String(process.env.ADMIN_NAMA || '').trim();
    const role = String(process.env.ADMIN_ROLE || 'Pemilik').trim();
    if (!username) return;
    if (password && password.length < 8) {
      throw new Error('ADMIN_PASSWORD minimal 8 karakter.');
    }
    const [rows] = await connection.query('SELECT id FROM admin_users WHERE username = ? LIMIT 1', [username]);
    if (rows.length) {
      if (!password) {
        if (role && role !== '') {
          await connection.query('UPDATE admin_users SET role = ?, nama_lengkap = COALESCE(NULLIF(?, \'\'), nama_lengkap) WHERE id = ?', [role, namaLengkap, rows[0].id]);
        }
        return;
      }
      const hash = await bcrypt.hash(password, 10);
      await connection.query('UPDATE admin_users SET password = ?, nama_lengkap = COALESCE(NULLIF(?, \'\'), nama_lengkap), role = ? WHERE id = ?', [hash, namaLengkap, role, rows[0].id]);
      return;
    }
    if (!password) throw new Error('Akun admin belum ada. Isi ADMIN_PASSWORD untuk membuatnya.');
    const hash = await bcrypt.hash(password, 10);
    await connection.query('INSERT INTO admin_users (username, password, nama_lengkap, role) VALUES (?, ?, NULLIF(?, \'\'), ?)', [username, hash, namaLengkap, role]);
  } finally {
    await connection.end();
  }
}

async function ensureJenisAktivitasPendidikan() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'db_alfilaha',
  });
  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS jenis_aktivitas_pendidikan (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nama VARCHAR(100) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  } finally {
    await connection.end();
  }
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'db_alfilaha',
  });
  let locked = false;

  try {
    const [lockRows] = await connection.query('SELECT GET_LOCK(?, 30) AS acquired', [LOCK_NAME]);
    if (Number(lockRows[0].acquired) !== 1) {
      throw new Error('Lock migrasi tidak dapat diperoleh.');
    }
    locked = true;

    for (const statement of coreSchemaStatements) {
      await connection.query(statement);
    }

    await ensureJenisAktivitasPendidikan();
    await runScript('./ensure-admin-schema.cjs');
    await ensureAdminFromEnv();
    await connection.query(
      'INSERT IGNORE INTO schema_migrations (version) VALUES (?)',
      [MIGRATION_VERSION],
    );
    console.log('db:migrate completed');
  } finally {
    try {
      if (locked) {
        await connection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
      }
    } finally {
      await connection.end();
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
