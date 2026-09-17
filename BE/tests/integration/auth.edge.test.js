// Auth tokens, Zod schema validation tests
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { generateExpiredToken, generateAuthToken, createTestUser } from '../helpers';

describe('Auth Flow Edge Cases & Zod Validation', () => {
    describe('JWT Token Validation', () => {
    it('should reject requests with an expired JWT (401 or 403)', async () => {
        const expiredToken = generateExpiredToken();

        const res = await request(app)
        .get('/api/media')
        .set('Authorization', `Bearer ${expiredToken}`);

        expect([401, 403]).toContain(res.status);
    });

    it('should reject malformed tokens', async () => {
        const res = await request(app)
        .get('/api/media')
        .set('Authorization', 'Bearer invalid.tampered.token');

        expect([401, 403]).toContain(res.status);
    });
});

  describe('Payload & Schema Bounds (Zod)', () => {
    it('should reject registration when email/password format fails Zod', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'not-an-email',
          password: '123',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should reject media rename with empty/invalid body', async () => {
      const user = await createTestUser();
      const token = generateAuthToken(user.id);

      const res = await request(app)
        .patch('/api/media/any-id')
        .set('Authorization', `Bearer ${token}`)
        .send({ originalFilename: '   ' });

      expect(res.status).toBe(400);
    });
  });
});