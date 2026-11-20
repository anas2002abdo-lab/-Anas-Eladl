import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const SQLITE_MAGIC_HEADER = Buffer.from('SQLite format 3\0', 'utf8');

function hasValidSqliteHeader(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  if (stat.size < 100) return false;
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, header, 0, 16, 0);
    return bytesRead === 16 && header.equals(SQLITE_MAGIC_HEADER);
  } finally {
    fs.closeSync(fd);
  }
}

function verifySqliteFileIntegrity(filePath: string): { ok: boolean; detail: string } {
  if (!hasValidSqliteHeader(filePath)) {
    return { ok: false, detail: 'Missing or invalid SQLite file header' };
  }
  const checkDb = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const res = String(checkDb.pragma('integrity_check', { simple: true }) || '');
    return res === 'ok' ? { ok: true, detail: 'ok' } : { ok: false, detail: res };
  } finally {
    checkDb.close();
  }
}

export function getPersistDir(): string | null {
  const raw = String(process.env.OTLOBHA_GCS_PERSIST_DIR || '').trim();
  return raw ? path.resolve(raw) : null;
}

/**
 * Safely hydrates the local POSIX SQLite working file from a mounted Cloud Storage FUSE
 * persistence directory BEFORE better-sqlite3 opens it.
 *
 * Why this exists:
 * Opening SQLite directly on Cloud Storage FUSE is unsafe because GCS FUSE is an object store
 * without true POSIX byte-range locks or atomic in-place random-write fsync. Running SQLite on
 * local container disk (WAL + synchronous=FULL) and synchronizing verified atomic snapshots to
 * GCS eliminates FUSE corruption risks while preserving persistence across container restarts.
 */
export function hydrateSqliteFromPersistDirIfNeeded(localDbPath: string): void {
  const persistDir = getPersistDir();
  if (!persistDir) return;

  const persistFile = path.join(persistDir, 'otlobha.db');
  const resolvedLocal = path.resolve(localDbPath);
  if (path.resolve(persistFile) === resolvedLocal) {
    throw new Error(
      `Unsafe SQLite configuration: OTLOBHA_DB_PATH (${resolvedLocal}) must NOT point directly inside OTLOBHA_GCS_PERSIST_DIR (${persistDir}). Use a local disk path such as /tmp/otlobha-local/otlobha.db.`
    );
  }

  fs.mkdirSync(path.dirname(resolvedLocal), { recursive: true });
  fs.mkdirSync(persistDir, { recursive: true });

  if (!fs.existsSync(persistFile)) {
    const requireExisting = String(process.env.OTLOBHA_REQUIRE_EXISTING_PERSISTED_DB || '').trim() === '1';
    const legacyMountHint =
      persistDir !== '/data' && fs.existsSync('/data/otlobha.db')
        ? ' Detected /data/otlobha.db on legacy mount path — ensure the GCS bucket is mounted at OTLOBHA_GCS_PERSIST_DIR.'
        : '';
    if (requireExisting) {
      throw new Error(
        `[SQLite Persist] Refusing to start: OTLOBHA_REQUIRE_EXISTING_PERSISTED_DB=1 is set, but ${persistFile} does not exist. Refusing to initialize an empty database.${legacyMountHint}`
      );
    }
    console.log(
      `[SQLite Persist] No existing snapshot at ${persistFile}; initializing local DB at ${resolvedLocal}.${legacyMountHint}`
    );
    return;
  }

  const stageLocal = `${resolvedLocal}.hydrate.${process.pid}`;
  fs.copyFileSync(persistFile, stageLocal);

  const check = verifySqliteFileIntegrity(stageLocal);
  if (!check.ok) {
    try {
      fs.unlinkSync(stageLocal);
    } catch {
      // ignore cleanup error
    }
    // Fail fast loudly instead of silently wiping production data with a blank database
    throw new Error(
      `[SQLite Persist] Refusing to start: persisted database at ${persistFile} failed integrity_check (${check.detail}). Restore a verified backup from GCS Object Versioning or backups/ before restarting.`
    );
  }

  // Clean any leftover WAL/SHM sidecars before swapping hydrated single-file DB into place
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const sidecar = `${resolvedLocal}${suffix}`;
    if (fs.existsSync(sidecar)) {
      fs.unlinkSync(sidecar);
    }
  }
  fs.renameSync(stageLocal, resolvedLocal);
  const sizeKb = (fs.statSync(resolvedLocal).size / 1024).toFixed(1);
  console.log(`[SQLite Persist] Hydrated verified SQLite snapshot (${sizeKb} KB) from ${persistFile} -> ${resolvedLocal}`);
}

export interface SqlitePersistController {
  flushNow: (reason: string, options?: { force?: boolean; createRollingBackup?: boolean }) => Promise<boolean>;
  scheduleFlush: (reason: string, delayMs?: number) => void;
  stop: () => void;
}

function isMountPointOnLinux(targetDir: string): boolean | null {
  try {
    if (!fs.existsSync('/proc/mounts')) return null;
    const resolved = path.resolve(targetDir);
    const mounts = fs.readFileSync('/proc/mounts', 'utf8').split('\n');
    for (const line of mounts) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const mountPath = parts[1];
      const fsType = parts[2];
      if (!mountPath || mountPath === '/' || mountPath === '/tmp') continue;
      if (resolved === mountPath || resolved.startsWith(`${mountPath}/`)) {
        // Real external mounts (gcsfuse, fuse, nfs, ext4 persistent disk, etc.)
        return fsType !== 'tmpfs' && fsType !== 'overlay';
      }
    }
    return false;
  } catch {
    return null;
  }
}

/**
 * Starts dirty-tracked, integrity-verified atomic snapshot syncing from local SQLite
 * to OTLOBHA_GCS_PERSIST_DIR (no-op when OTLOBHA_GCS_PERSIST_DIR is not configured).
 */
export function startSqlitePersistSync(
  db: Database.Database,
  localDbPath: string
): SqlitePersistController {
  const persistDir = getPersistDir();
  if (!persistDir) {
    if (process.env.K_SERVICE) {
      console.warn(
        '[SQLite Persist] WARNING: Running on Cloud Run without OTLOBHA_GCS_PERSIST_DIR — local SQLite data is ephemeral and will be lost on container restart or scale-to-zero.'
      );
    }
    return {
      flushNow: async () => false,
      scheduleFlush: () => {},
      stop: () => {},
    };
  }

  if (process.env.K_SERVICE) {
    const mounted = isMountPointOnLinux(persistDir);
    if (mounted === false) {
      console.warn(
        `[SQLite Persist] WARNING: ${persistDir} is NOT mounted to a Cloud Storage bucket or persistent volume. Data saved to SQLite will be lost whenever Cloud Run restarts, scales to zero, or routes to another instance.`
      );
    }
  }

  const syncIntervalMs = Math.max(5000, Number(process.env.OTLOBHA_SQLITE_SYNC_INTERVAL_MS || 15000));
  const rollingIntervalMs = Math.max(
    5 * 60 * 1000,
    Number(process.env.OTLOBHA_ROLLING_BACKUP_INTERVAL_MS || 30 * 60 * 1000)
  );
  const rollingKeepCount = Math.max(3, Number(process.env.OTLOBHA_ROLLING_BACKUP_KEEP || 24));

  const persistFile = path.join(persistDir, 'otlobha.db');
  const backupsDir = path.join(persistDir, 'backups');
  const tmpSnapPath = `${path.resolve(localDbPath)}.sync-snapshot.db`;

  let inFlight: Promise<boolean> | null = null;
  let lastSyncedFingerprint = '';
  let lastRollingBackupAt = 0;

  const getWriteFingerprint = (): string => {
    try {
      const totalChanges = (db.prepare('SELECT total_changes() as c').get() as { c: number }).c;
      const dataVersion = Number(db.pragma('data_version', { simple: true }) || 0);
      return `${totalChanges}:${dataVersion}`;
    } catch {
      return `err:${Date.now()}`;
    }
  };

  // Capture initial fingerprint after DB init; if remote file didn't exist yet, force first sync
  const persistAlreadyExists = fs.existsSync(persistFile);
  if (persistAlreadyExists) {
    lastSyncedFingerprint = getWriteFingerprint();
  }

  const pruneRollingBackups = () => {
    try {
      if (!fs.existsSync(backupsDir)) return;
      const files = fs
        .readdirSync(backupsDir)
        .filter((f) => f.startsWith('otlobha-auto-') && f.endsWith('.db'))
        .sort();
      while (files.length > rollingKeepCount) {
        const oldest = files.shift();
        if (oldest) {
          fs.unlinkSync(path.join(backupsDir, oldest));
        }
      }
    } catch (err) {
      console.warn('[SQLite Persist] Rolling backup prune warning:', err instanceof Error ? err.message : err);
    }
  };

  const performSync = async (
    reason: string,
    options?: { force?: boolean; createRollingBackup?: boolean }
  ): Promise<boolean> => {
    const currentFp = getWriteFingerprint();
    const shouldForce = Boolean(options?.force) || !fs.existsSync(persistFile);
    if (!shouldForce && currentFp === lastSyncedFingerprint) {
      return false;
    }

    try {
      fs.mkdirSync(persistDir, { recursive: true });
      if (fs.existsSync(tmpSnapPath)) {
        fs.unlinkSync(tmpSnapPath);
      }

      // 1. Online consistent SQLite backup (safe while serving traffic, no lock corruption)
      await db.backup(tmpSnapPath);

      // 2. Ensure single-file self-contained format (DELETE journal) & verify integrity_check
      const snapDb = new Database(tmpSnapPath);
      try {
        snapDb.pragma('journal_mode = DELETE');
        const integrity = String(snapDb.pragma('integrity_check', { simple: true }) || '');
        if (integrity !== 'ok') {
          throw new Error(`Snapshot integrity_check failed: ${integrity}`);
        }
      } finally {
        snapDb.close();
      }

      const sha256 = crypto.createHash('sha256').update(fs.readFileSync(tmpSnapPath)).digest('hex');

      // 3. Stage inside persist dir and atomically swap into otlobha.db
      const stagingRemote = path.join(persistDir, `.otlobha.db.staging.${process.pid}.${Date.now()}`);
      fs.copyFileSync(tmpSnapPath, stagingRemote);
      fs.renameSync(stagingRemote, persistFile);

      // 4. Write companion checksum metadata (non-critical if skipped)
      try {
        fs.writeFileSync(
          path.join(persistDir, 'otlobha.db.sha256'),
          `${sha256}  otlobha.db\n`,
          'utf8'
        );
      } catch {
        // ignore metadata write errors
      }

      // 5. Rolling timestamped backup inside backups/
      const now = Date.now();
      if (options?.createRollingBackup || now - lastRollingBackupAt >= rollingIntervalMs) {
        try {
          fs.mkdirSync(backupsDir, { recursive: true });
          const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const rollingTarget = path.join(backupsDir, `otlobha-auto-${stamp}.db`);
          fs.copyFileSync(tmpSnapPath, rollingTarget);
          lastRollingBackupAt = now;
          pruneRollingBackups();
        } catch (err) {
          console.warn('[SQLite Persist] Rolling backup skipped:', err instanceof Error ? err.message : err);
        }
      }

      lastSyncedFingerprint = currentFp;
      const sizeKb = (fs.statSync(tmpSnapPath).size / 1024).toFixed(1);
      console.log(`[SQLite Persist] Synced verified snapshot (${sizeKb} KB, sha256=${sha256.slice(0, 12)}) [${reason}]`);
      return true;
    } catch (err) {
      console.error(`[SQLite Persist] Sync failed [${reason}]:`, err instanceof Error ? err.message : err);
      return false;
    } finally {
      try {
        if (fs.existsSync(tmpSnapPath)) fs.unlinkSync(tmpSnapPath);
      } catch {
        // ignore
      }
    }
  };

  const flushNow = (reason: string, options?: { force?: boolean; createRollingBackup?: boolean }): Promise<boolean> => {
    if (inFlight) {
      return inFlight.then(() => performSync(reason, options));
    }
    inFlight = performSync(reason, options).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleFlush = (reason: string, delayMs = 1200) => {
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      flushNow(reason).catch(() => {});
    }, Math.max(250, delayMs));
    debounceTimer.unref?.();
  };

  const timer = setInterval(() => {
    flushNow('periodic').catch(() => {});
  }, syncIntervalMs);
  timer.unref?.();

  // Ensure initial file exists on first boot when bucket was empty
  if (!persistAlreadyExists) {
    flushNow('initial-seed', { force: true, createRollingBackup: true }).catch(() => {});
  }

  return {
    flushNow,
    scheduleFlush,
    stop: () => {
      clearInterval(timer);
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    },
  };
}
