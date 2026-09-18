import '../setup.js';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { createTestUser } from '../helpers.js';

describe('Phase 3: Rate Limiting & Refresh Token Architecture', () => {
  let user;
  const rawPassword = 'Password123456!';

  beforeEach(async () => {
    user = await createTestUser({ password: rawPassword });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /api/auth/login & Refresh Cookie Strategy', () => {
    it('should issue short-lived accessToken and set httpOnly refreshToken cookie', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: rawPassword });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();

      const refreshCookie = cookies.find((c) => c.startsWith('refreshToken='));
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toMatch(/HttpOnly/i);
      expect(refreshCookie).toMatch(/SameSite=Strict/i);
    });

    it('should generate a new accessToken when sending a valid refreshToken cookie to /refresh', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: rawPassword });

      expect(loginRes.status).toBe(200);
      const authCookie = loginRes.headers['set-cookie'];

      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', authCookie);

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body).toHaveProperty('accessToken');
    });

    it('should clear the refreshToken cookie on /logout', async () => {
      const res = await request(app).post('/api/auth/logout');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Logged out successfully');

      const cookies = res.headers['set-cookie'];
      expect(cookies[0]).toMatch(/refreshToken=;/);
    });
  });

  describe('Rate Limiting (authLimiter)', () => {
    it('should block requests with 429 status code after hitting rate limit threshold', async () => {
      // Use unique email to avoid interference
      const payload = { email: `ratelimit-${Date.now()}@vault.local`, password: 'WrongPassword123!' };

      for (let i = 0; i < 10; i++) {
        await request(app).post('/api/auth/login').send(payload);
      }

      const blockedRes = await request(app).post('/api/auth/login').send(payload);

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.error).toMatch(/Too many authentication attempts/i);
    });
  });
});