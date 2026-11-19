import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function inspectDatabase(filePath: string) {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = String(db.pragma('integrity_check', { simple: true }) || '');
    const journalMode = String(db.pragma('journal_mode', { simple: true }) || '');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>;
    const rowCounts: Record<string, number> = {};
    for (const t of tables) {
      const safeName = t.name.replace(/"/g, '""');
      const countRow = db.prepare(`SELECT COUNT(*) as c FROM "${safeName}"`).get() as { c: number };
      rowCounts[t.name] = countRow.c;
    }
    return { integrity, journalMode, tableCount: tables.length, rowCounts };
  } finally {
    db.close();
  }
}

async function verifyMode(targetPath: string) {
  const absTarget = path.resolve(process.cwd(), targetPath);
  if (!fs.existsSync(absTarget)) {
    console.error(`[Verify] Backup file not found: ${absTarget}`);
    process.exit(1);
  }
  const actualSha256 = crypto.createHash('sha256').update(fs.readFileSync(absTarget)).digest('hex');
  const shaFile = `${absTarget}.sha256`;
  if (fs.existsSync(shaFile)) {
    const expectedSha256 = fs.readFileSync(shaFile, 'utf8').trim().split(/\s+/)[0];
    if (expectedSha256 !== actualSha256) {
      console.error(`[Verify] SHA-256 mismatch! expected=${expectedSha256} actual=${actualSha256}`);
      process.exit(1);
    }
  }
  const report = inspectDatabase(absTarget);
  if (report.integrity !== 'ok') {
    console.error(`[Verify] SQLite integrity_check failed: ${report.integrity}`);
    process.exit(1);
  }
  const sizeBytes = fs.statSync(absTarget).size;
  console.log(
    JSON.stringify(
      {
        ok: true,
        backup_path: absTarget,
        size_bytes: sizeBytes,
        sha256: actualSha256,
        journal_mode: report.journalMode,
        integrity_check: report.integrity,
        table_count: report.tableCount,
        total_rows: Object.values(report.rowCounts).reduce((a, b) => a + b, 0),
      },
      null,
      2
    )
  );
}

async function main() {
  if (process.argv[2] === '--verify') {
    if (!process.argv[3]) {
      console.error('Usage: tsx scripts/checkpoint-sqlite.ts --verify <backup.db>');
      process.exit(1);
    }
    await verifyMode(process.argv[3]);
    return;
  }

  const sourcePath = process.env.OTLOBHA_DB_PATH
    ? path.resolve(process.env.OTLOBHA_DB_PATH)
    : path.resolve(process.cwd(), 'otlobha.db');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outArg = process.argv[2] || `.backups/otlobha-backup-${timestamp}.db`;
  const outPath = path.resolve(process.cwd(), outArg);

  if (!fs.existsSync(sourcePath)) {
    console.error(`[Checkpoint] Source SQLite database not found: ${sourcePath}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  if (fs.existsSync(outPath)) {
    fs.unlinkSync(outPath);
  }

  // Open source read-only? Online db.backup() requires normal open without mutating user tables
  const db = new Database(sourcePath);
  try {
    db.pragma('busy_timeout = 10000');
    await db.backup(outPath);
  } finally {
    db.close();
  }

  // Convert snapshot journal mode to DELETE so it is a single self-contained file
  const snapDb = new Database(outPath);
  try {
    snapDb.pragma('journal_mode = DELETE');
    const integrity = String(snapDb.pragma('integrity_check', { simple: true }) || '');
    if (integrity !== 'ok') {
      throw new Error(`SQLite integrity_check failed: ${integrity}`);
    }
  } finally {
    snapDb.close();
  }

  const report = inspectDatabase(outPath);
  const sizeBytes = fs.statSync(outPath).size;
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(outPath)).digest('hex');

  fs.writeFileSync(`${outPath}.sha256`, `${sha256}  ${path.basename(outPath)}\n`, 'utf8');
  fs.writeFileSync(
    `${outPath}.manifest.json`,
    JSON.stringify(
      {
        created_at: new Date().toISOString(),
        source_db: path.basename(sourcePath),
        backup_file: path.basename(outPath),
        size_bytes: sizeBytes,
        sha256,
        journal_mode: report.journalMode,
        integrity_check: report.integrity,
        table_count: report.tableCount,
        row_counts: report.rowCounts,
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        backup_path: outPath,
        checksum_path: `${outPath}.sha256`,
        manifest_path: `${outPath}.manifest.json`,
        size_bytes: sizeBytes,
        sha256,
        integrity_check: report.integrity,
        table_count: report.tableCount,
        total_rows: Object.values(report.rowCounts).reduce((a, b) => a + b, 0),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error('[Checkpoint] Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
