import { openPool, checkDatabase } from './lib/db.mjs';
import { createApp, settings } from './lib/http.mjs';
import { createMailer } from './lib/mail.mjs';

const pool = openPool();
try {
  const config = settings();
  const info = await checkDatabase(pool, config);
  const mailer = createMailer();
  const server = createApp({ pool, config, mailer });
  server.listen(config.port, '127.0.0.1', () => {
    console.log('Safcodes Admin: ' + config.origin);
    console.log('PostgreSQL database: ' + info.database + ' · email: ' + mailer.mode);
  });
  server.on('error', async error => {
    console.error(error.code === 'EADDRINUSE' ? 'This port is already in use. Stop the previous admin server or choose another PORT and PUBLIC_ORIGIN.' : 'Could not start the admin server.');
    await pool.end();
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => pool.end()));
} catch (error) {
  console.error(error.code ? 'Could not connect to PostgreSQL. Check api/.env, the PostgreSQL service and the worker password.' : error.message);
  await pool.end();
  process.exitCode = 1;
}
