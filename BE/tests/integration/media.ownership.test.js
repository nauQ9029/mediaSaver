// Multi-tenant user isolation tests
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { generateAuthToken, createTestUser, createTestMedia } from '../helpers';
import { prisma } from '../../src/lib/prisma';
import jwt from 'jsonwebtoken';
import { HeadObjectCommand } from '@aws-sdk/client-s3';

const r2Mocks = vi.hoisted(() => ({ send: vi.fn(), getR2ObjectUrl: vi.fn() }));
const redisMocks = vi.hoisted(() => ({ get: vi.fn(), setex: vi.fn() }));
vi.mock('../../src/config/redis.js', () => ({
  redis: {
    get: redisMocks.get,
    setex: redisMocks.setex,
  },
}));

vi.mock('../../src/config/r2.js', () => ({
  getR2BucketName: () => 'test-bucket',
  getR2Client: () => ({ send: r2Mocks.send }),
  getR2ObjectUrl: r2Mocks.getR2ObjectUrl,
}));

describe('Multi-Tenant Ownership Security Boundaries', () => {
  let userA, userB;
  let tokenA;
  let mediaUserA, mediaUserB;

  beforeEach(async () => {
    // Clear test tables or set up fresh test entities
    userA = await createTestUser();
    userB = await createTestUser();

    tokenA = generateAuthToken(userA.id);
    mediaUserA = await createTestMedia({ ownerId: userA.id, originalFilename: 'userA_doc.pdf' });
    mediaUserB = await createTestMedia({ ownerId: userB.id, originalFilename: 'userB_secret.png' });
    r2Mocks.send.mockReset();
    r2Mocks.getR2ObjectUrl.mockReset();
    redisMocks.get.mockReset().mockResolvedValue(null);
    redisMocks.setex.mockReset().mockResolvedValue('OK');
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

    describe('GET /api/media (Tenant Isolation)', () => {
        it("should only return User A's media and omit User B's media", async () => {
            const res = await request(app)
                .get('/api/media')
                .set('Authorization', `Bearer ${tokenA}`);

        expect(res.status).toBe(200);

        // Extract list whether it's raw or wrapped in an object
        const mediaList = Array.isArray(res.body)
            ? res.body
            : res.body.data || res.body.media || [];

        expect(Array.isArray(mediaList)).toBe(true);

        const ids = mediaList.map((item) => item.id);
        expect(ids).toContain(mediaUserA.id);
        expect(ids).not.toContain(mediaUserB.id);
      });
    });

  describe('PATCH /api/media/:id (Cross-Tenant Edit)', () => {
    it("should reject User A's attempt to edit User B's metadata", async () => {
      const res = await request(app)
        .patch(`/api/media/${mediaUserB.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ originalFilename: 'hacked_name.png' });

      expect([403, 404]).toContain(res.status);
    });
  });

  describe('DELETE /api/media/:id (Cross-Tenant Delete)', () => {
    it("should prevent User A from deleting User B's media", async () => {
      const res = await request(app)
        .delete(`/api/media/${mediaUserB.id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect([403, 404]).toContain(res.status);
    });
  });

  describe('GET /api/media/:id/download (Cross-Tenant Download)', () => {
    it("should prevent User A from generating a download URL for User B's media", async () => {
      const res = await request(app)
        .get(`/api/media/${mediaUserB.id}/download`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect([403, 404]).toContain(res.status);
      expect(r2Mocks.getR2ObjectUrl).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/media/:id/transform (Cross-Tenant Token)', () => {
    it("should reject User A's transform token for User B's media", async () => {
      const token = jwt.sign(
        { mediaId: mediaUserB.id, purpose: 'media-image-transform' },
        process.env.JWT_SECRET || 'test-secret',
        { subject: userA.id, expiresIn: '15m' },
      );

      const res = await request(app)
        .get(`/api/media/${mediaUserB.id}/transform`)
        .query({ token });

      expect(res.status).toBe(404);
      expect(r2Mocks.send).not.toHaveBeenCalled();
    });

    it("should let User B's valid transform token redirect to a signed private variant", async () => {
      const r2Media = await prisma.media.update({
        where: { id: mediaUserB.id },
        data: { storageProvider: 'R2', publicId: `vault/users/${userB.id}/original.png` },
      });
      const token = jwt.sign(
        { mediaId: r2Media.id, purpose: 'media-image-transform' },
        process.env.JWT_SECRET || 'test-secret',
        { subject: userB.id, expiresIn: '15m' },
      );
      r2Mocks.send.mockImplementation(async (command) => {
        if (command instanceof HeadObjectCommand) return {};
        throw new Error(`Unexpected R2 command: ${command.constructor.name}`);
      });
      r2Mocks.getR2ObjectUrl.mockResolvedValue('https://private-r2.test/signed-variant');

      const res = await request(app)
        .get(`/api/media/${r2Media.id}/transform`)
        .query({ token });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://private-r2.test/signed-variant');
      expect(r2Mocks.getR2ObjectUrl).toHaveBeenCalledWith(
        `vault/users/${userB.id}/.variants/${r2Media.id}/w800-q80.webp`,
      );
    });
  });
});
