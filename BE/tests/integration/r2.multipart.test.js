
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import {
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  getR2BucketName: vi.fn(() => 'test-bucket'),
  getR2ObjectUrl: vi.fn(async (key) => `https://cdn.test/${key}`),
  redisKeys: vi.fn(async () => []),
  redisDel: vi.fn(async () => 1),
}));

vi.mock('../../src/config/r2.js', () => ({
  getR2BucketName: mocks.getR2BucketName,
  getR2Client: () => ({ send: mocks.send }),
  getR2ObjectUrl: mocks.getR2ObjectUrl,
}));

vi.mock('../../src/config/redis.js', () => ({
  redis: {
    keys: mocks.redisKeys,
    del: mocks.redisDel,
  },
}));

import app from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { createTestUser, generateAuthToken } from '../helpers';

describe('R2 multipart upload integration', () => {
  let userA;
  let userB;
  let tokenA;
  let tokenB;
  let key;
  let uploadId;

  // Use realistic multipart sizes: the final part may be smaller.
  const part1Size = 10 * 1024 * 1024;
  const part2Size = 1 * 1024 * 1024;
  const fileSize = part1Size + part2Size;

  const uploadedParts = [
    { PartNumber: 1, ETag: 'etag-part-1' },
    { PartNumber: 2, ETag: 'etag-part-2' },
  ];

  const validPayload = () => ({
    key,
    uploadId,
    parts: uploadedParts.map((part) => ({ ...part })),
    fileName: 'large-video.mp4',
    mimeType: 'video/mp4',
    fileSize,
  });

  const mediaCount = (ownerId) =>
    prisma.media.count({
      where: { ownerId, publicId: key },
    });

  beforeEach(async () => {
    userA = await createTestUser();
    userB = await createTestUser();

    tokenA = generateAuthToken(userA.id);
    tokenB = generateAuthToken(userB.id);

    key = `vault/users/${userA.id}/test-upload-key`;
    uploadId = 'test-upload-id';

    mocks.send.mockReset();
    mocks.getR2ObjectUrl.mockClear();
    mocks.redisKeys.mockReset();
    mocks.redisKeys.mockResolvedValue([]);
    mocks.redisDel.mockReset();
    mocks.redisDel.mockResolvedValue(1);

    // Default successful R2 behavior.
    mocks.send.mockImplementation(async (command) => {
      if (command instanceof ListPartsCommand) {
        return {
          Parts: uploadedParts.map((part) => ({
            ...part,
            Size: part.PartNumber === 1 ? part1Size : part2Size,
          })),
          IsTruncated: false,
        };
      }

      if (command instanceof CompleteMultipartUploadCommand) {
        return {};
      }

      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: fileSize,
          ContentType: 'video/mp4',
        };
      }

      throw new Error(`Unexpected R2 command: ${command.constructor.name}`);
    });
  });

  afterEach(async () => {
    // Remove only records owned by this test.
    if (userA && key) {
      await prisma.media.deleteMany({
        where: { ownerId: userA.id, publicId: key },
      });
    }

    if (userA || userB) {
      const ids = [userA?.id, userB?.id].filter(Boolean);

      await prisma.media.deleteMany({
        where: { ownerId: { in: ids } },
      });

      await prisma.user.deleteMany({
        where: { id: { in: ids } },
      });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const complete = (payload = validPayload(), token = tokenA) =>
    request(app)
      .post('/api/upload/r2/multipart/complete')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

  const expectNoCompletion = () => {
    expect(
      mocks.send.mock.calls.some(
        ([command]) => command instanceof CompleteMultipartUploadCommand,
      ),
    ).toBe(false);
  };

  it('completes a valid upload and creates one media record', async () => {
    const res = await complete();

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.originalFilename).toBe('large-video.mp4');
    expect(res.body.data.mimeType).toBe('video/mp4');
    expect(res.body.data.mediaType).toBe('VIDEO');
    expect(res.body.data.bytes).toBe(fileSize);
    expect(res.body.data.ownerId).toBe(userA.id);
    expect(res.body.data.deliveryUrl).toBe(
      `https://cdn.test/${key}`,
    );

    expect(await mediaCount(userA.id)).toBe(1);

    const completionCommand = mocks.send.mock.calls
      .map(([command]) => command)
      .find((command) => command instanceof CompleteMultipartUploadCommand);

    expect(completionCommand).toBeDefined();
    expect(completionCommand.input.MultipartUpload.Parts).toEqual(
      uploadedParts,
    );
  });

  it('rejects an empty parts array', async () => {
    const res = await complete({ ...validPayload(), parts: [] });

    expect(res.status).toBe(400);
    expectNoCompletion();
    expect(await mediaCount(userA.id)).toBe(0);
  });

  it('rejects duplicate part numbers', async () => {
    const parts = [
      uploadedParts[0],
      { ...uploadedParts[1], PartNumber: 1 },
    ];

    const res = await complete({ ...validPayload(), parts });

    expect(res.status).toBe(400);
    expectNoCompletion();
    expect(await mediaCount(userA.id)).toBe(0);
  });

  it.each([0, -1, 10001, 1.5, NaN])(
    'rejects invalid part number %s',
    async (partNumber) => {
      const parts = [
        { ...uploadedParts[0], PartNumber: partNumber },
        uploadedParts[1],
      ];

      const res = await complete({ ...validPayload(), parts });

      expect(res.status).toBe(400);
      expectNoCompletion();
      expect(await mediaCount(userA.id)).toBe(0);
    },
  );

  it('rejects an ETag that does not match R2', async () => {
    const parts = [
      { ...uploadedParts[0], ETag: 'wrong-etag' },
      uploadedParts[1],
    ];

    const res = await complete({ ...validPayload(), parts });

    expect(res.status).toBe(400);
    expectNoCompletion();
    expect(await mediaCount(userA.id)).toBe(0);
  });

  it('rejects a completion missing an uploaded part', async () => {
    const res = await complete({
      ...validPayload(),
      parts: [uploadedParts[0]],
    });

    expect(res.status).toBe(400);
    expectNoCompletion();
    expect(await mediaCount(userA.id)).toBe(0);
  });

  it('rejects a part that was never uploaded', async () => {
    const parts = [
      uploadedParts[0],
      { PartNumber: 3, ETag: 'etag-part-3' },
    ];

    const res = await complete({ ...validPayload(), parts });

    expect(res.status).toBe(400);
    expectNoCompletion();
    expect(await mediaCount(userA.id)).toBe(0);
  });

  it('rejects another user’s upload key', async () => {
    const res = await complete(
      validPayload(),
      tokenB,
    );

    expect(res.status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(await mediaCount(userA.id)).toBe(0);
  });

  it('rejects an invalid expected file size', async () => {
    const res = await complete({
      ...validPayload(),
      fileSize: -1,
    });

    expect(res.status).toBe(400);
    expectNoCompletion();
    expect(await mediaCount(userA.id)).toBe(0);
  });

  it('does not create a media record when R2 completion fails', async () => {
    mocks.send.mockImplementation(async (command) => {
      if (command instanceof ListPartsCommand) {
        return {
          Parts: uploadedParts,
          IsTruncated: false,
        };
      }

      if (command instanceof CompleteMultipartUploadCommand) {
        throw new Error('Simulated R2 failure');
      }

      throw new Error(`Unexpected R2 command: ${command.constructor.name}`);
    });

    const res = await complete();

    expect(res.status).toBe(500);
    expect(await mediaCount(userA.id)).toBe(0);
  });

  it('does not create a media record if the completed object size mismatches', async () => {
    mocks.send.mockImplementation(async (command) => {
      if (command instanceof ListPartsCommand) {
        return {
          Parts: uploadedParts,
          IsTruncated: false,
        };
      }

      if (command instanceof CompleteMultipartUploadCommand) {
        return {};
      }

      if (command instanceof HeadObjectCommand) {
        return { ContentLength: fileSize - 1 };
      }

      throw new Error(`Unexpected R2 command: ${command.constructor.name}`);
    });

    const res = await complete();

    expect(res.status).toBe(400);
    expect(await mediaCount(userA.id)).toBe(0);
  });

  it('does not create a media record if the database insert fails', async () => {
    const createSpy = vi
      .spyOn(prisma.media, 'create')
      .mockRejectedValueOnce(new Error('Simulated database failure'));

    try {
      const res = await complete();

      expect(res.status).toBe(500);
      expect(await mediaCount(userA.id)).toBe(0);

      expect(
        mocks.send.mock.calls.some(
          ([command]) => command instanceof CompleteMultipartUploadCommand,
        ),
      ).toBe(true);
    } finally {
      createSpy.mockRestore();
    }
  });

  it('requires part numbers in ascending order', async () => {
    const res = await complete({
      ...validPayload(),
      parts: [uploadedParts[1], uploadedParts[0]],
    });

    // This is a desired invariant. The current route does not enforce it,
    // so this test is expected to fail until the route is fixed.
    expect(res.status).toBe(400);
    expectNoCompletion();
    expect(await mediaCount(userA.id)).toBe(0);
  });
});