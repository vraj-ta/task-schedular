import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { type Readable } from 'node:stream';

import type { ArtifactKind, ArtifactStorage } from '@task-scheduler/shared-types';

import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * Local-filesystem artifact storage. Each artifact is written to:
 *   `<root>/<projectSlug>/<jobId>/<artifactId>__<filename>`
 *
 * The `JobArtifact` row records the absolute path, byte size, sha256, and a
 * declared mime type. Signed URLs (see lib/signed-url.ts) authorize downloads.
 *
 * S3 storage is Phase 2; the `storage` enum already exists in the schema so
 * a future implementation can swap in without a migration.
 */
export interface StoreArtifactInput {
  projectConnectionId: string;
  projectSlug: string;
  jobId: string;
  kind: ArtifactKind;
  filename: string;
  mimeType: string;
  expiresAt?: Date | null;
}

export interface StoredArtifact {
  id: string;
  storage: ArtifactStorage;
  path: string;
  sizeBytes: bigint;
  checksumSha256: string;
}

export interface ArtifactStore {
  /** Persist a stream as a new artifact row. Returns the persisted metadata. */
  writeFromStream(input: StoreArtifactInput, source: Readable): Promise<StoredArtifact>;
  /** Return a readable stream for a stored artifact. */
  readStream(artifactId: string): Promise<{ stream: Readable; mimeType: string; filename: string; sizeBytes: bigint }>;
  /** Delete a stored artifact and its row. */
  remove(artifactId: string): Promise<boolean>;
}

const safePathSegment = (s: string): string =>
  s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);

export interface LocalArtifactStoreDeps {
  prisma: PrismaClient;
  rootDir: string;
}

export const createLocalArtifactStore = (deps: LocalArtifactStoreDeps): ArtifactStore => ({
  async writeFromStream(input, source) {
    const id = randomUUID();
    const dir = path.join(
      deps.rootDir,
      safePathSegment(input.projectSlug),
      safePathSegment(input.jobId),
    );
    await mkdir(dir, { recursive: true });
    const absPath = path.join(dir, `${id}__${safePathSegment(input.filename)}`);

    const hasher = createHash('sha256');
    let sizeBytes = 0n;
    source.on('data', (chunk: Buffer) => {
      hasher.update(chunk);
      sizeBytes += BigInt(chunk.length);
    });

    const dest = createWriteStream(absPath);
    await pipeline(source, dest);

    const checksumSha256 = hasher.digest('hex');

    const row = await deps.prisma.jobArtifact.create({
      data: {
        id,
        projectConnectionId: input.projectConnectionId,
        jobId: input.jobId,
        kind: input.kind,
        filename: input.filename,
        storage: 'LOCAL',
        path: absPath,
        sizeBytes,
        mimeType: input.mimeType,
        checksumSha256,
        expiresAt: input.expiresAt ?? null,
      },
      select: {
        id: true,
        storage: true,
        path: true,
        sizeBytes: true,
        checksumSha256: true,
      },
    });

    return {
      id: row.id,
      storage: row.storage as ArtifactStorage,
      path: row.path,
      sizeBytes: row.sizeBytes,
      checksumSha256: row.checksumSha256 ?? checksumSha256,
    };
  },

  async readStream(artifactId) {
    const row = await deps.prisma.jobArtifact.findUnique({
      where: { id: artifactId },
      select: { path: true, mimeType: true, filename: true, sizeBytes: true, storage: true },
    });
    if (!row) throw new Error(`artifact ${artifactId} not found`);
    if (row.storage !== 'LOCAL') {
      throw new Error(`artifact ${artifactId} storage=${row.storage} not supported by local store`);
    }
    // Verify the file is still present.
    await stat(row.path).catch(() => {
      throw new Error(`artifact ${artifactId} file missing at ${row.path}`);
    });
    return {
      stream: createReadStream(row.path),
      mimeType: row.mimeType,
      filename: row.filename,
      sizeBytes: row.sizeBytes,
    };
  },

  async remove(artifactId) {
    const row = await deps.prisma.jobArtifact.findUnique({
      where: { id: artifactId },
      select: { id: true, path: true, storage: true },
    });
    if (!row) return false;
    if (row.storage === 'LOCAL') {
      await unlink(row.path).catch(() => { /* file may already be gone */ });
    }
    await deps.prisma.jobArtifact.delete({ where: { id: artifactId } });
    return true;
  },
});
