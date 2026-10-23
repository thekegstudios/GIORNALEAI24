import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
if (process.env.DATABASE_URL) throw new Error('Per PostgreSQL usare il backup del provider o pg_dump prima della migrazione.');
const source = path.resolve(process.env.DATABASE_PATH || '.data/italia-ora.sqlite');
const directory = path.resolve('data/backups');
await mkdir(directory, { recursive: true });
const destination = path.join(directory, `giornale-ai24-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
const database = new DatabaseSync(source, { readOnly: true });
try {
  await backup(database, destination);
  console.log(`Backup SQLite completato: ${destination}`);
} finally { database.close(); }
