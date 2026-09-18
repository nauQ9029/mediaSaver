import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import app from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { createTestUser } from '../helpers';

// Mock Nodemailer email dispatch function
vi.mock('../../src/lib/email.js', () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ messageId: 'test-message-id' }),
}));

describe('Password Reset Flow Edge Cases', () => {
  let user;
  const rawPassword = 'Password123456!';

  beforeEach(async () => {
    user = await createTestUser({ password: rawPassword });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /api/auth/forgot-password', () => {
    it('should issue a reset token and return generic success for existing user', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: user.email });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/If an account exists/i);

      // Verify DB stored hashed token and expiration window
      const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
      expect(updatedUser.resetPasswordToken).not.toBeNull();
      expect(new Date(updatedUser.resetPasswordExpires).getTime()).toBeGreaterThan(Date.now());
    });

    it('should return generic success for non-existent email (User Enumeration Prevention)', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nonexistent-user-999@vault.local' });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/If an account exists/i);
    });

    it('should reject invalid email payload with Zod 400 error', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/auth/verify-reset-token/:token', () => {
    it('should validate a fresh, non-expired reset token', async () => {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetPasswordToken: hashedToken,
          resetPasswordExpires: new Date(Date.now() + 15 * 60 * 1000),
        },
      });

      const res = await request(app).get(`/api/auth/verify-reset-token/${rawToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Token is valid');
    });

    it('should reject an expired reset token', async () => {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

      // Set token to expire in the past
      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetPasswordToken: hashedToken,
          resetPasswordExpires: new Date(Date.now() - 5000),
        },
      });

      const res = await request(app).get(`/api/auth/verify-reset-token/${rawToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid or has expired/i);
    });

    it('should reject non-existent or invalid token string', async () => {
      const res = await request(app).get('/api/auth/verify-reset-token/invalid-tampered-token');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid or has expired/i);
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('should successfully update password and invalidate the reset token', async () => {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      const newPassword = 'NewSecurePassword123!';

      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetPasswordToken: hashedToken,
          resetPasswordExpires: new Date(Date.now() + 15 * 60 * 1000),
        },
      });

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: rawToken, newPassword });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/successfully reset/i);

      // Verify database cleanup
      const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
      expect(updatedUser.resetPasswordToken).toBeNull();
      expect(updatedUser.resetPasswordExpires).toBeNull();

      // Verify user can now log in with the new password
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: newPassword });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body).toHaveProperty('accessToken');
    });

    it('should reject new password if it fails Zod length validation (< 12 chars)', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'valid-token', newPassword: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid payload/i);
    });
  });
});