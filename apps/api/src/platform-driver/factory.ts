import { getPrisma } from '../db.js';
import { decrypt, loadEncryptionKey } from '../utils/crypto.js';

import { DotNetPlatformDriver } from './dotnet-driver.js';
import type { PlatformConnectionInfo, PlatformDriver } from './driver.interface.js';
import { NodePlatformDriver } from './node-driver.js';

/**
 * Resolve and cache a `PlatformDriver` instance per `PlatformConnection.id`.
 *
 * Cache key is the connection id; we evict (and `close()`) when the
 * underlying credentials change (`PlatformConnection.updatedAt` differs from
 * the cached value).
 */
interface CacheEntry {
  driver: PlatformDriver;
  updatedAt: Date;
}

const cache = new Map<string, CacheEntry>();

const toBuffer = (b: Uint8Array | Buffer): Buffer =>
  Buffer.isBuffer(b) ? b : Buffer.from(b);

const decryptCredentials = (cipher: Uint8Array | Buffer | null): unknown => {
  if (!cipher) return null;
  try {
    return JSON.parse(decrypt(toBuffer(cipher), loadEncryptionKey()));
  } catch {
    return null;
  }
};

export const getDriverForConnection = async (
  projectConnectionId: string,
): Promise<PlatformDriver> => {
  const row = await getPrisma().platformConnection.findUnique({
    where: { id: projectConnectionId },
    select: {
      id: true,
      projectSlug: true,
      baseUrl: true,
      targetType: true,
      enabled: true,
      credentialsCiphertext: true,
      updatedAt: true,
    },
  });
  if (!row) {
    throw new Error(`PlatformConnection '${projectConnectionId}' not found`);
  }
  if (!row.enabled) {
    throw new Error(`PlatformConnection '${row.projectSlug}' is disabled`);
  }

  const cached = cache.get(row.id);
  if (cached && cached.updatedAt.getTime() === row.updatedAt.getTime()) {
    return cached.driver;
  }
  if (cached) {
    await cached.driver.close().catch(() => { /* ignore */ });
    cache.delete(row.id);
  }

  const info: PlatformConnectionInfo = {
    id: row.id,
    projectSlug: row.projectSlug,
    baseUrl: row.baseUrl,
    targetType: row.targetType,
    credentials: decryptCredentials(row.credentialsCiphertext),
  };
  const driver: PlatformDriver =
    row.targetType === 'DOTNET'
      ? new DotNetPlatformDriver(info)
      : new NodePlatformDriver(info);
  cache.set(row.id, { driver, updatedAt: row.updatedAt });
  return driver;
};

export const closeAllDrivers = async (): Promise<void> => {
  for (const entry of cache.values()) {
    await entry.driver.close().catch(() => { /* ignore */ });
  }
  cache.clear();
};
