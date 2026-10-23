require("dotenv").config({ quiet: true });

const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");

const LOCK_NAME = "alfilaha_admin_schema";
const MIN_PASSWORD_LENGTH = 8;

const tableStatements = [
  `CREATE TABLE IF NOT EXISTS admin_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    nama_lengkap VARCHAR(100),
    role VARCHAR(50) DEFAULT 'Petugas'
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    nama_lengkap VARCHAR(100),
    role VARCHAR(50) DEFAULT 'user'
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS tahun_ajaran (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tahun VARCHAR(20) NOT NULL,
    aktif TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tahun_ajaran (tahun)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS user_peran (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    peran ENUM('guru','santri','petugas') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_peran (user_id, peran),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS jenis_aktivitas_pendidikan (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

async function columnExists(connection, table, column) {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
}

async function ensureColumn(connection, table, column, definition) {
  if (await columnExists(connection, table, column)) return false;
  await connection.query(
    `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`,
  );
  return true;
}

async function ensureAdminUser(connection) {
  const username = String(process.env.ADMIN_USERNAME || "").trim();
  const password = String(process.env.ADMIN_PASSWORD || "");
  const namaLengkap = String(process.env.ADMIN_NAMA || "").trim();
  const role = String(process.env.ADMIN_ROLE || "Pemilik").trim();

  if (!username && !password) return;
  if (!username) throw new Error("ADMIN_USERNAME wajib diisi.");
  if (password && password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `ADMIN_PASSWORD minimal ${MIN_PASSWORD_LENGTH} karakter.`,
    );
  }

  const [rows] = await connection.query(
    "SELECT id FROM admin_users WHERE username = ? LIMIT 1",
    [username],
  );

  if (rows.length) {
    if (!password) {
      console.log(`Akun admin "${username}" sudah ada; password tidak diubah.`);
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    await connection.query(
      `UPDATE admin_users
       SET password = ?, nama_lengkap = COALESCE(NULLIF(?, ''), nama_lengkap), role = ?
       WHERE id = ?`,
      [hash, namaLengkap, role, rows[0].id],
    );
    console.log(`Akun admin "${username}" diperbarui.`);
    return;
  }

  if (!password) {
    throw new Error(
      `Akun admin "${username}" belum ada. Isi ADMIN_PASSWORD untuk membuatnya.`,
    );
  }

  const hash = await bcrypt.hash(password, 10);
  await connection.query(
    `INSERT INTO admin_users (username, password, nama_lengkap, role)
     VALUES (?, ?, NULLIF(?, ''), ?)`,
    [username, hash, namaLengkap, role],
  );
  console.log(`Akun admin "${username}" dibuat.`);
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "db_alfilaha",
  });

  let locked = false;

  try {
    const [lockRows] = await connection.query(
      "SELECT GET_LOCK(?, 30) AS acquired",
      [LOCK_NAME],
    );
    if (Number(lockRows[0].acquired) !== 1) {
      throw new Error("Lock migrasi tidak dapat diperoleh.");
    }
    locked = true;

    for (const statement of tableStatements) {
      await connection.query(statement);
    }

    const addedNama = await ensureColumn(
      connection,
      "admin_users",
      "nama_lengkap",
      "VARCHAR(100) NULL",
    );
    const addedRole = await ensureColumn(
      connection,
      "admin_users",
      "role",
      "VARCHAR(50) DEFAULT 'Petugas'",
    );

    await ensureAdminUser(connection);

    const [admins] = await connection.query(
      "SELECT id, username, nama_lengkap, role FROM admin_users ORDER BY id",
    );
    console.log("Tabel admin dan pendidikan siap.");
    if (addedNama) console.log("Kolom admin_users.nama_lengkap ditambahkan.");
    if (addedRole) console.log("Kolom admin_users.role ditambahkan.");
    console.log("Akun admin tersedia:", admins);
  } finally {
    if (locked) {
      await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
    }
    await connection.end();
  }
}

main().catch((error) => {
  console.error("Setup admin gagal:", error.message);
  process.exitCode = 1;
});
