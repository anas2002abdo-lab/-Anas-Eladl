import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export function isCloudSqlConfigured(): boolean {
  return Boolean(
    process.env.SQL_HOST &&
      process.env.SQL_USER &&
      process.env.SQL_PASSWORD &&
      process.env.SQL_DB_NAME
  );
}

export const createPool = (): Pool => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 10,
      // Cloud SQL Developer Edition supports scale-to-zero:
      // - 30s connection timeout allows smooth cold wake-up after idle periods
      // - 20s idle timeout retires sockets before Cloud SQL suspends them
      // - TCP keepAlive detects half-open sockets early
      connectionTimeoutMillis: 30000,
      idleTimeoutMillis: 20000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      allowExitOnIdle: false,
    });

    global._postgresPool.on('error', (err) => {
      console.error('[CloudSQL] Unexpected error on idle SQL pool client:', err instanceof Error ? err.message : err);
    });
  }
  return global._postgresPool;
};

export const pool = createPool();
export const pgDb = drizzle(pool, { schema });
export const db = pgDb;
