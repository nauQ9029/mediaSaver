import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  processMediaMetadata: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Worker: class {
    on() { return this; }
  },
  UnrecoverableError: class UnrecoverableError extends Error {},
}));

vi.mock('../../src/config/redis.js', () => ({ redis: {} }));
vi.mock('../../src/queues/mediaQueue.js', () => ({
  MEDIA_QUEUE_NAME: 'media-processing-queue',
  MEDIA_METADATA_JOB: 'PROCESS_METADATA',
}));
vi.mock('../../src/lib/prisma.js', () => ({
  prisma: { media: { updateMany: mocks.updateMany } },
}));
vi.mock('../../src/services/mediaMetadata.js', () => ({
  processMediaMetadata: mocks.processMediaMetadata,
  PermanentMediaMetadataError: class PermanentMediaMetadataError extends Error {},
}));

import { processMediaJob } from '../../src/workers/mediaWorker.js';
import { PermanentMediaMetadataError } from '../../src/services/mediaMetadata.js';

const createJob = (attemptsMade) => ({
  id: 'media-metadata-media-1',
  name: 'PROCESS_METADATA',
  attemptsMade,
  opts: { attempts: 3 },
  data: { mediaId: 'media-1', ownerId: 'owner-1', publicId: 'vault/users/owner-1/image.png' },
});

describe('media metadata worker retry policy', () => {
  beforeEach(() => {
    mocks.processMediaMetadata.mockReset();
    mocks.updateMany.mockReset();
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it('leaves media PENDING while a transient failure can still retry', async () => {
    mocks.processMediaMetadata.mockRejectedValue(new Error('Temporary R2 outage'));

    await expect(processMediaJob(createJob(0))).rejects.toThrow('Temporary R2 outage');

    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('marks media FAILED only after the final configured attempt', async () => {
    mocks.processMediaMetadata.mockRejectedValue(new Error('Temporary R2 outage'));

    await expect(processMediaJob(createJob(2))).rejects.toThrow('Temporary R2 outage');

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 'media-1', ownerId: 'owner-1', status: 'PENDING' },
      data: { status: 'FAILED' },
    });
  });

  it('marks permanent processing errors FAILED without consuming retry attempts', async () => {
    mocks.processMediaMetadata.mockRejectedValue(new PermanentMediaMetadataError('Unsupported image'));

    await expect(processMediaJob(createJob(0))).rejects.toThrow('Unsupported image');

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 'media-1', ownerId: 'owner-1', status: 'PENDING' },
      data: { status: 'FAILED' },
    });
  });
});
