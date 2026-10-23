import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const path = new URL('../.env.local', import.meta.url);
if (existsSync(path)) {
  console.log('.env.local esiste già: nessun dato è stato sovrascritto.');
} else {
  let env = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  for (const key of ['ADMIN_PASSWORD', 'SESSION_SECRET', 'CRON_SECRET']) {
    env = env.replace(new RegExp(`^${key}=$`, 'm'), `${key}=${randomBytes(32).toString('base64url')}`);
  }
  writeFileSync(path, env, { mode: 0o600, flag: 'wx' });
  console.log('Configurazione locale creata in .env.local (esclusa da Git). Le credenziali del pannello sono in quel file.');
}
