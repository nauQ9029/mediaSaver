import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const mocks = vi.hoisted(() => ({
  media: { id: 'media-1', ownerId: 'owner-1', publicId: 'vault/users/owner-1/image.png', storageProvider: 'R2', mediaType: 'IMAGE', status: 'PENDING' },
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  send: vi.fn(),
}));

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: { media: { findFirst: mocks.findFirst, updateMany: mocks.updateMany } },
}));

vi.mock('../../src/config/r2.js', () => ({
  getR2BucketName: () => 'test-bucket',
  getR2Client: () => ({ send: mocks.send }),
}));

import { processMediaMetadata } from '../../src/services/mediaMetadata.js';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gXcAAAAASUVORK5CYII=',
  'base64',
);

describe('processMediaMetadata', () => {
  beforeEach(() => {
    mocks.media = {
      id: 'media-1', ownerId: 'owner-1', publicId: 'vault/users/owner-1/image.png',
      storageProvider: 'R2', mediaType: 'IMAGE', status: 'PENDING',
    };
    mocks.findFirst.mockReset();
    mocks.findFirst.mockImplementation(async () => ({ ...mocks.media }));
    mocks.updateMany.mockReset();
    mocks.updateMany.mockImplementation(async ({ where, data }) => {
      if (mocks.media.status !== where.status) return { count: 0 };
      Object.assign(mocks.media, data);
      return { count: 1 };
    });
    mocks.send.mockReset();
    mocks.send.mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) return { ContentLength: onePixelPng.length };
      if (command instanceof GetObjectCommand) {
        return { Body: { transformToByteArray: async () => new Uint8Array(onePixelPng) } };
      }
      throw new Error(`Unexpected R2 command: ${command.constructor.name}`);
    });
  });

  it('extracts image dimensions and conditionally transitions PENDING to READY', async () => {
    await processMediaMetadata('media-1', 'owner-1', 'vault/users/owner-1/image.png');

    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'media-1', ownerId: 'owner-1', publicId: 'vault/users/owner-1/image.png', status: 'PENDING' },
      data: expect.objectContaining({ width: 1, height: 1, status: 'READY' }),
    }));
    expect(mocks.media.status).toBe('READY');
  });

  it('is idempotent when the same completed job runs again', async () => {
    await processMediaMetadata('media-1', 'owner-1', 'vault/users/owner-1/image.png');
    const callsAfterFirstRun = mocks.send.mock.calls.length;

    await processMediaMetadata('media-1', 'owner-1', 'vault/users/owner-1/image.png');

    expect(mocks.send).toHaveBeenCalledTimes(callsAfterFirstRun);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.media.status).toBe('READY');
  });

  it('converges safely when duplicate jobs process concurrently', async () => {
    await Promise.all([
      processMediaMetadata('media-1', 'owner-1', 'vault/users/owner-1/image.png'),
      processMediaMetadata('media-1', 'owner-1', 'vault/users/owner-1/image.png'),
    ]);

    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    const updates = await Promise.all(mocks.updateMany.mock.results.map((result) => result.value));
    expect(updates.filter((result) => result.count === 1)).toHaveLength(1);
    expect(mocks.media.status).toBe('READY');
  });

  it('marks videos ready without attempting unsupported metadata extraction', async () => {
    mocks.media.mediaType = 'VIDEO';

    await processMediaMetadata('media-1', 'owner-1', 'vault/users/owner-1/image.png');

    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'READY' },
    }));
  });
});
