import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

const mocks = vi.hoisted(() => ({ send: vi.fn(), redisKeys: vi.fn(), redisDel: vi.fn() }));

vi.mock('../../src/config/r2.js', () => ({
  getR2BucketName: () => 'test-bucket',
  getR2Client: () => ({ send: mocks.send }),
  getR2ObjectUrl: vi.fn(),
}));

vi.mock('../../src/config/redis.js', () => ({
  redis: { keys: mocks.redisKeys, del: mocks.redisDel },
}));

import app from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { createTestMedia, createTestUser, generateAuthToken } from '../helpers';

describe('R2 media deletion consistency', () => {
  let user;
  let token;
  let media;
  const variantKey = () => `vault/users/${user.id}/.variants/${media.id}/w800-q80.webp`;

  beforeEach(async () => {
    user = await createTestUser();
    token = generateAuthToken(user.id);
    media = await createTestMedia({
      ownerId: user.id,
      storageProvider: 'R2',
      publicId: `vault/users/${user.id}/original.jpg`,
    });

    mocks.send.mockReset();
    mocks.redisKeys.mockReset();
    mocks.redisKeys.mockResolvedValue([]);
    mocks.redisDel.mockReset();
    mocks.redisDel.mockResolvedValue(1);
  });

  afterEach(async () => {
    if (user) {
      await prisma.media.deleteMany({ where: { ownerId: user.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const deleteMedia = () => request(app)
    .delete(`/api/media/${media.id}`)
    .set('Authorization', `Bearer ${token}`);

  const expectOriginalAndRowRemain = async () => {
    expect(mocks.send.mock.calls.some(([command]) =>
      command instanceof DeleteObjectCommand && command.input.Key === media.publicId,
    )).toBe(false);
    expect(await prisma.media.findUnique({ where: { id: media.id } })).not.toBeNull();
  };

  it('preserves the original object and database row when variant deletion throws', async () => {
    mocks.send.mockImplementation(async (command) => {
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [{ Key: variantKey() }], IsTruncated: false };
      }
      if (command instanceof DeleteObjectsCommand) {
        throw new Error('Simulated R2 variant deletion failure');
      }
      throw new Error(`Unexpected R2 command: ${command.constructor.name}`);
    });

    const response = await deleteMedia();

    expect(response.status).toBe(500);
    await expectOriginalAndRowRemain();
  });

  it('preserves the original object and database row when DeleteObjects reports an object error', async () => {
    mocks.send.mockImplementation(async (command) => {
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [{ Key: variantKey() }], IsTruncated: false };
      }
      if (command instanceof DeleteObjectsCommand) {
        return { Errors: [{ Key: variantKey(), Code: 'AccessDenied', Message: 'Denied' }] };
      }
      throw new Error(`Unexpected R2 command: ${command.constructor.name}`);
    });

    const response = await deleteMedia();

    expect(response.status).toBe(500);
    await expectOriginalAndRowRemain();
  });

  it('deletes variants, original object, and database row after successful cleanup', async () => {
    const sentCommands = [];

    mocks.send.mockImplementation(async (command) => {
      sentCommands.push(command);

      if (command instanceof ListObjectsV2Command) {
        // First list finds the variant; verification list is empty.
        const listCalls = sentCommands.filter(
          (item) => item instanceof ListObjectsV2Command,
        );

        if (listCalls.length === 1) {
          return {
            Contents: [{ Key: variantKey() }],
            IsTruncated: false,
          };
        }

        return {
          Contents: [],
          IsTruncated: false,
        };
      }

      if (command instanceof DeleteObjectsCommand) {
        return {};
      }

      if (command instanceof DeleteObjectCommand) {
        return {};
      }

      throw new Error(`Unexpected R2 command: ${command.constructor.name}`);
    });

    const response = await deleteMedia();

    expect(response.status).toBe(204);

    expect(
      sentCommands.some(
        (command) =>
          command instanceof DeleteObjectsCommand &&
          command.input.Delete?.Objects?.some(
            (object) => object.Key === variantKey(),
          ),
      ),
    ).toBe(true);

    expect(
      sentCommands.some(
        (command) =>
          command instanceof DeleteObjectCommand &&
          command.input.Key === media.publicId,
      ),
    ).toBe(true);

    expect(
      await prisma.media.findUnique({ where: { id: media.id } }),
    ).toBeNull();
  });
});
