import { spawnSync } from 'node:child_process';

// Never publish a serverless instance backed by a temporary local database.
// Netlify Database can be created in Data & Storage > Database before building.
if (process.env.NETLIFY === 'true') {
  const missing = [];
  if (!(process.env.DATABASE_URL || process.env.NETLIFY_DB_URL)) missing.push('DATABASE_URL oppure NETLIFY_DB_URL');
  if (!process.env.ADMIN_USERNAME) missing.push('ADMIN_USERNAME');
  for (const name of ['ADMIN_PASSWORD', 'SESSION_SECRET', 'CRON_SECRET']) {
    if ((process.env[name] || '').length < 32) missing.push(`${name} (almeno 32 caratteri)`);
  }
  try {
    const site = new URL(process.env.SITE_URL || '');
    if (site.protocol !== 'https:' || site.username || site.password || site.pathname !== '/' || site.search || site.hash) throw new Error();
  } catch { missing.push('SITE_URL (origine HTTPS pubblica esatta)'); }
  if (missing.length) {
    console.error(`Configurazione Netlify incompleta: ${missing.join(', ')}. Imposta le variabili nel pannello Netlify, ambiti Builds e Functions; nessun segreto viene stampato.`);
    process.exit(1);
  }
}

const result = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build', '--webpack'], { stdio: 'inherit', env: process.env });
if (result.error) {
  console.error('Impossibile avviare la build Next.js. Verifica installazione e runtime Node.js.');
  process.exit(1);
}
process.exit(result.status ?? 1);
