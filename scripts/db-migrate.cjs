require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const { execSync } = require('child_process');

const MIGRATION_VERSION = '20260925_consolidated';
const LOCK_NAME = 'alfilaha_schema_migrations';

async function runScript(relativePath) {
  const scriptPath = require('path').resolve(__dirname, relativePath);
  try {
    execSync(`node "${scriptPath}"`, { stdio: 'inherit', env: process.env });
  } catch (err) {
    throw err;
  }
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
  // Run full schema migration from frontend logic if present
  try {
    await runScript('../alfilaha-react/scripts/db-migrate.cjs');
  } catch (e) {
    // If not accessible, continue
  }
  await ensureJenisAktivitasPendidikan();
  await runScript('./ensure-admin-schema.cjs');
  await ensureAdminFromEnv();
  console.log('db:migrate completed');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
