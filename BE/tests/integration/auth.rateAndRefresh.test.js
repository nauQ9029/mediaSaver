import '../setup.js';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
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

    it('should rotate the refresh token and reject reuse of the old token', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: rawPassword });

      expect(loginRes.status).toBe(200);

      const oldCookie = loginRes.headers['set-cookie']
        .find((cookie) => cookie.startsWith('refreshToken='));

      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', oldCookie);

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body).toHaveProperty('accessToken');

      const newCookie = refreshRes.headers['set-cookie']
        .find((cookie) => cookie.startsWith('refreshToken='));

      expect(newCookie).toBeDefined();
      expect(newCookie).not.toBe(oldCookie);

      const replayRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', oldCookie);

      expect(replayRes.status).toBe(401);

      // Reusing the old token must not invalidate the replacement token.
      const nextRefreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', newCookie);

      expect(nextRefreshRes.status).toBe(200);
    });

    it('should reject a refresh token that has been revoked by logout', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: rawPassword });

      const cookie = loginRes.headers['set-cookie']
        .find((value) => value.startsWith('refreshToken='));

      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', cookie);

      expect(logoutRes.status).toBe(200);

      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', cookie);

      expect(refreshRes.status).toBe(401);
    });

    it('should allow only one of two concurrent refresh requests to succeed', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: rawPassword });

      const cookie = loginRes.headers['set-cookie']
        .find((value) => value.startsWith('refreshToken='));

      const responses = await Promise.all([
        request(app).post('/api/auth/refresh').set('Cookie', cookie),
        request(app).post('/api/auth/refresh').set('Cookie', cookie),
      ]);

      expect(responses.filter((res) => res.status === 200)).toHaveLength(1);
      expect(responses.filter((res) => res.status === 401)).toHaveLength(1);
    });

    it('should reject an expired refresh token', async () => {
      const jwt = (await import('jsonwebtoken')).default;

      const expiredToken = jwt.sign(
        { userId: user.id, jti: 'expired-test-token' },
        process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET,
        { expiresIn: -1 }
      );

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', `refreshToken=${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
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