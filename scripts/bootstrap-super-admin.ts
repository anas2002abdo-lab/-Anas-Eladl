import crypto from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { ensureBootstrapSuperAdmin, initDatabase } from '../src/server/db.ts';

const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

function upsertEnvKeys(filePath: string, updates: Record<string, string>): string[] {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const lines = existing ? existing.split(/\r?\n/) : [];
  const addedKeys: string[] = [];

  for (const [key, val] of Object.entries(updates)) {
    const idx = lines.findIndex((line) => {
      const trimmed = line.trim();
      return trimmed.startsWith(`${key}=`);
    });
    if (idx === -1) {
      lines.push(`${key}="${val}"`);
      addedKeys.push(key);
    } else {
      const currentVal = lines[idx].slice(lines[idx].indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
      if (!currentVal) {
        lines[idx] = `${key}="${val}"`;
        addedKeys.push(key);
      }
    }
  }

  const normalized = lines.filter((l, i, arr) => !(i === arr.length - 1 && l === '')).join('\n') + '\n';
  fs.writeFileSync(filePath, normalized, { encoding: 'utf8', mode: 0o600 });
  return addedKeys;
}

const jwtUpdates: Record<string, string> = {};
if (!String(process.env.JWT_ACCESS_SECRET || '').trim()) {
  const generatedAccess = crypto.randomBytes(48).toString('hex');
  process.env.JWT_ACCESS_SECRET = generatedAccess;
  jwtUpdates.JWT_ACCESS_SECRET = generatedAccess;
}
if (!String(process.env.JWT_REFRESH_SECRET || '').trim()) {
  const generatedRefresh = crypto.randomBytes(48).toString('hex');
  process.env.JWT_REFRESH_SECRET = generatedRefresh;
  jwtUpdates.JWT_REFRESH_SECRET = generatedRefresh;
}

const savedJwtKeys = Object.keys(jwtUpdates).length > 0 ? upsertEnvKeys(envPath, jwtUpdates) : [];
if (savedJwtKeys.length > 0) {
  console.log(`[Setup] Securely generated and stored keys in .env: ${savedJwtKeys.join(', ')}`);
} else {
  console.log('[Setup] JWT signing keys already configured.');
}

initDatabase();
const result = ensureBootstrapSuperAdmin();
console.log('[Bootstrap Result]', JSON.stringify(result));
