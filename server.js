const { execFileSync } = require('node:child_process');
const path = require('node:path');

if (require.main === module) {
  execFileSync(process.execPath, [path.join(__dirname, 'scripts/db-migrate.cjs')], {
    stdio: 'inherit',
    env: process.env,
  });

  const { startServer, shutdownServer } = require('./server-update.cjs');
  process.once('SIGINT', shutdownServer);
  process.once('SIGTERM', shutdownServer);
  startServer();
}
