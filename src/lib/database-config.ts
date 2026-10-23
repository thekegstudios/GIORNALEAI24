import path from 'node:path';

type Environment = Record<string, string | undefined>;
export type DatabaseConfig =
  | { kind: 'postgres'; pool: { connectionString: string; max: number; connectionTimeoutMillis: number; statement_timeout: number; idleTimeoutMillis: number; allowExitOnIdle: boolean } }
  | { kind: 'sqlite'; filename: string };

/** Keep credentials server-side and refuse an ephemeral production database. */
export function resolveDatabaseConfig(env: Environment = process.env, cwd = process.cwd()): DatabaseConfig {
  const netlifyCloud = env.NETLIFY === 'true' && env.NETLIFY_DEV !== 'true';
  const connectionString = env.DATABASE_URL?.trim() || env.NETLIFY_DB_URL?.trim();
  if (connectionString) return { kind: 'postgres', pool: {
    connectionString,
    max: netlifyCloud ? 2 : 5,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: netlifyCloud,
  } };
  if (netlifyCloud) throw new Error('Su Netlify serve un database PostgreSQL persistente: configura DATABASE_URL oppure NETLIFY_DB_URL. SQLite locale non è disponibile nelle funzioni cloud.');
  return { kind: 'sqlite', filename: env.DATABASE_PATH || path.join(cwd, '.data', 'italia-ora.sqlite') };
}
