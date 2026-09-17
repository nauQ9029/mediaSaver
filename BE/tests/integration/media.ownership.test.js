// Multi-tenant user isolation tests
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { generateExpiredToken, generateAuthToken, createTestUser, createTestMedia } from '../helpers';
import { prisma } from '../../src/lib/prisma';

describe('Multi-Tenant Ownership Security Boundaries', () => {
  let userA, userB;
  let tokenA, tokenB;
  let mediaUserA, mediaUserB;

  beforeEach(async () => {
    // Clear test tables or set up fresh test entities
    userA = await createTestUser();
    userB = await createTestUser();

    tokenA = generateAuthToken(userA.id);
    tokenB = generateAuthToken(userB.id);

    mediaUserA = await createTestMedia({ ownerId: userA.id, originalFilename: 'userA_doc.pdf' });
    mediaUserB = await createTestMedia({ ownerId: userB.id, originalFilename: 'userB_secret.png' });
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
});