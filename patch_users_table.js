const mysql = require('mysql2');
require('dotenv').config();

const db = mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "db_alfilaha",
});

db.connect((err) => {
  if (err) throw err;
  console.log("Connected to db");
  db.query("ALTER TABLE users ADD COLUMN status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending'", (err) => {
    if (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        console.log("Column status already exists");
      } else {
        console.error(err);
      }
    } else {
      console.log("Column status added successfully");
      db.query("UPDATE users SET status = 'approved'", () => {
         console.log("Set existing users to approved");
         process.exit();
      });
      return;
    }
    process.exit();
  });
});
