import { initDatabase, closeDatabase } from '../src/lib/db';
try { await initDatabase(); console.log('Database inizializzato. Registro fonti pronto.'); } finally { await closeDatabase(); }
