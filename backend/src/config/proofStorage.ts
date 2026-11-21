import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export type ProofStorage = {
  save(buffer: Buffer, mimeType: 'image/jpeg' | 'image/png' | 'image/webp'): Promise<{ storageKey: string }>;
  delete(storageKey: string): Promise<void>;
};

const extensionByMimeType: Record<'image/jpeg' | 'image/png' | 'image/webp', string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};

export class LocalProofStorage implements ProofStorage {
  constructor(private readonly rootDirectory: string) {}

  async save(buffer: Buffer, mimeType: 'image/jpeg' | 'image/png' | 'image/webp'): Promise<{ storageKey: string }> {
    await fs.mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    const storageKey = `${crypto.randomUUID()}${extensionByMimeType[mimeType]}`;
    const target = path.join(this.rootDirectory, storageKey);
    await fs.writeFile(target, buffer, { mode: 0o600, flag: 'wx' });
    return { storageKey };
  }

  async delete(storageKey: string): Promise<void> {
    if (!/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}\.(jpg|png|webp)$/i.test(storageKey)) {
      return;
    }
    await fs.rm(path.join(this.rootDirectory, storageKey), { force: true });
  }

  async clearTestDirectory(): Promise<void> {
    await fs.rm(this.rootDirectory, { recursive: true, force: true });
  }
}

export const proofStorage = new LocalProofStorage(
  process.env.PROOF_STORAGE_DIR
    ? path.resolve(process.env.PROOF_STORAGE_DIR)
    : path.resolve(process.cwd(), 'storage', 'proofs')
);
