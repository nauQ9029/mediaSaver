import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  cache: new Map(),
  keys: vi.fn(),
  del: vi.fn(),
}));

vi.mock('../../src/config/redis.js', () => ({
  redis: {
    get: vi.fn(async (key) => mocks.cache.get(key) ?? null),
    setex: vi.fn(async (key, _ttl, value) => { mocks.cache.set(key, value); return 'OK'; }),
    keys: mocks.keys,
    del: mocks.del,
  },
}));

vi.mock('../../src/config/r2.js', () => ({
  getR2BucketName: () => 'test-bucket',
  getR2Client: () => ({ send: vi.fn(async () => ({})) }),
  getR2ObjectUrl: vi.fn(async (key) => `https://private-r2.test/${key}`),
}));

import app from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { createTestMedia, createTestUser, generateAuthToken } from '../helpers';

describe('Media gallery cache isolation and invalidation', () => {
  let userA;
  let userB;
  let tokenA;
  let tokenB;
  let mediaA;
  let mediaB;

  beforeEach(async () => {
    mocks.cache.clear();
    mocks.keys.mockReset();
    mocks.del.mockReset();
    mocks.keys.mockImplementation(async (pattern) =>
      [...mocks.cache.keys()].filter((key) => {
        const prefix = pattern.slice(0, -1);
        return key.startsWith(prefix);
      }),
    );
    mocks.del.mockImplementation(async (...keys) => {
      keys.flat().forEach((key) => mocks.cache.delete(key));
      return keys.length;
    });

    userA = await createTestUser();
    userB = await createTestUser();
    tokenA = generateAuthToken(userA.id);
    tokenB = generateAuthToken(userB.id);
    mediaA = await createTestMedia({ ownerId: userA.id, originalFilename: 'user-a.jpg' });
    mediaB = await createTestMedia({ ownerId: userB.id, originalFilename: 'user-b.jpg' });
  });

  afterEach(async () => {
    const ids = [userA?.id, userB?.id].filter(Boolean);
    if (ids.length) {
      await prisma.media.deleteMany({ where: { ownerId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const gallery = (token) => request(app)
    .get('/api/media')
    .set('Authorization', `Bearer ${token}`);

  it('does not serve one user gallery from another user cache entry', async () => {
    const responseA = await gallery(tokenA);
    const responseB = await gallery(tokenB);

    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);
    expect(responseA.body.data.map((item) => item.id)).toContain(mediaA.id);
    expect(responseA.body.data.map((item) => item.id)).not.toContain(mediaB.id);
    expect(responseB.body.data.map((item) => item.id)).toContain(mediaB.id);
    expect(responseB.body.data.map((item) => item.id)).not.toContain(mediaA.id);
  });

  it('invalidates the owner gallery cache after a metadata update', async () => {
    const initial = await gallery(tokenA);
    expect(initial.body.data.find((item) => item.id === mediaA.id).originalFilename).toBe('user-a.jpg');

    const update = await request(app)
      .patch(`/api/media/${mediaA.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ originalFilename: 'renamed.jpg' });

    expect(update.status).toBe(200);
    expect(mocks.del).toHaveBeenCalled();

    const refreshed = await gallery(tokenA);
    expect(refreshed.body.data.find((item) => item.id === mediaA.id).originalFilename).toBe('renamed.jpg');
  });

  it('invalidates the owner gallery cache after deletion', async () => {
    await gallery(tokenA);
    expect(mocks.cache.size).toBeGreaterThan(0);

    const deletion = await request(app)
      .delete(`/api/media/${mediaA.id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(deletion.status).toBe(204);
    expect(mocks.del).toHaveBeenCalled();

    const refreshed = await gallery(tokenA);
    expect(refreshed.body.data.map((item) => item.id)).not.toContain(mediaA.id);
  });
});
