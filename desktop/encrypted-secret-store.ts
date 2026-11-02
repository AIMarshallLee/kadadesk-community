import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/** The part of Electron's safeStorage this store uses (injected, so the store is testable without Electron). */
export interface StringCipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/**
 * One secret (the 连接增长飞轮 key) kept encrypted by the operating system (Electron safeStorage: Keychain on macOS,
 * DPAPI on Windows, the secret service on Linux). The file holds only the ciphertext. Without encryption nothing is
 * written: `set` refuses, so a key is never stored in plain text.
 */
export function createEncryptedSecretStore(file: string, cipher: StringCipher) {
  const available = () => { try { return cipher.isEncryptionAvailable(); } catch { return false; } };
  return {
    available,
    async get(): Promise<string | undefined> {
      try {
        const value = (JSON.parse(await readFile(file, 'utf8')) as { value?: unknown }).value;
        if (typeof value !== 'string' || !value) return undefined;
        return cipher.decryptString(Buffer.from(value, 'base64'));
      } catch { return undefined; }
    },
    async set(value: string): Promise<void> {
      if (!available()) throw new Error('这台电脑没有可用的加密存储，密钥不能保存。');
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
      try {
        await writeFile(tmp, JSON.stringify({ value: cipher.encryptString(value).toString('base64') }), { encoding: 'utf8', mode: 0o600 });
        await rename(tmp, file);
      } catch (e) { await unlink(tmp).catch(() => {}); throw e; }
    },
    async delete(): Promise<void> { await unlink(file).catch(() => {}); },
  };
}
