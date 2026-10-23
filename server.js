require('./server-update.cjs');

const { startServer, shutdownServer } = require('./server-update.cjs');

process.once('SIGINT', shutdownServer);
process.once('SIGTERM', shutdownServer);

if (require.main === module) {
  startServer();
}
