import { safeStorage } from 'electron';
import { getDb } from '../db/database';
import crypto from 'node:crypto';

/**
 * 凭据保险柜 — 使用 Electron safeStorage 调用 OS 钥匙串加密。
 * 数据库只存 credential_ref（uuid）+ 加密后的 base64 密文，
 * 明文密码/私钥永远不进 SQLite 文本字段。
 */

interface VaultRow {
  ref: string;
  cipher: Buffer;
}

function ensureTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS credential_vault (
      ref TEXT PRIMARY KEY,
      cipher BLOB NOT NULL
    );
  `);
}

export function saveCredential(secret: string): string {
  ensureTable();
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统未提供安全存储（钥匙串/Credential Manager）');
  }
  const ref = crypto.randomUUID();
  const cipher = safeStorage.encryptString(secret);
  getDb().prepare('INSERT INTO credential_vault(ref, cipher) VALUES (?, ?)').run(ref, cipher);
  return ref;
}

export function readCredential(ref: string): string {
  ensureTable();
  const row = getDb().prepare('SELECT ref, cipher FROM credential_vault WHERE ref = ?').get(ref) as
    | VaultRow
    | undefined;
  if (!row) throw new Error(`Credential not found: ${ref}`);
  return safeStorage.decryptString(row.cipher);
}

export function updateCredential(ref: string, secret: string): void {
  ensureTable();
  const cipher = safeStorage.encryptString(secret);
  getDb().prepare('UPDATE credential_vault SET cipher = ? WHERE ref = ?').run(cipher, ref);
}

export function deleteCredential(ref: string): void {
  ensureTable();
  getDb().prepare('DELETE FROM credential_vault WHERE ref = ?').run(ref);
}
