import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { sendPasswordResetEmail } from '../lib/email.js';
import { authLimiter } from '../middleware/rateLimiter.js';

const router = Router();

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(72),
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(12).max(72),
});

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return secret;
}

function getRefreshSecret() {
  const secret = process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('REFRESH_TOKEN_SECRET is not configured');
  return secret;
}

// Helper to set httpOnly Refresh Token cookie safely
const setRefreshTokenCookie = (res: Response, refreshToken: string) => {
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createRefreshToken(userId: string): string {
  return jwt.sign(
    {
      userId,
      jti: crypto.randomUUID(),
    },
    getRefreshSecret(),
    { expiresIn: '7d' }
  );
}

function createAccessToken(user: { id: string; email: string }): string {
  return jwt.sign(
    { userId: user.id, email: user.email },
    getJwtSecret(),
    { expiresIn: '15m' }
  );
}

/**
 * Create a new refresh-token session or rotation record.
 * Pass a Prisma client or transaction client.
 */
async function persistRefreshToken(
  db: typeof prisma,
  userId: string,
  familyId: string,
  refreshToken: string
) {
  return db.refreshToken.create({
    data: {
      userId,
      familyId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
}

/**
 * Issue a refresh token for a new login session.
 */
async function createRefreshSession(userId: string) {
  const refreshToken = createRefreshToken(userId);
  const familyId = crypto.randomUUID();

  await persistRefreshToken(prisma, userId, familyId, refreshToken);

  return refreshToken;
}

// REGISTER USER
router.post('/register', authLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Use a valid email and a password of 12 to 72 characters' });
    }
    const { email, password } = parsed.data;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'Email is already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
      },
      select: { id: true, email: true, createdAt: true },
    });

    const accessToken = createAccessToken(user);
    const refreshToken = await createRefreshSession(user.id);

    setRefreshTokenCookie(res, refreshToken);

    res.status(201).json({ user, accessToken });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// LOGIN USER
router.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const accessToken = createAccessToken(user);
    const refreshToken = await createRefreshSession(user.id);

    setRefreshTokenCookie(res, refreshToken);

    res.json({
      user: { id: user.id, email: user.email },
      accessToken,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// REQUEST PASSWORD RESET (FORGOT PASSWORD)
router.post('/forgot-password', authLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    const { email } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });

    const successMessage = 'If an account exists with that email, a password reset link has been sent.';

    if (!user) {
      return res.json({ message: successMessage });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expires = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: expires,
      },
    });

    const resetUrl = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/reset-password?token=${resetToken}`;

    try {
      await sendPasswordResetEmail({ to: user.email, resetUrl });
    } catch (emailError) {
      console.error('Failed to dispatch password reset email:', emailError);
      return res.status(503).json({
        error: 'Password reset email is not configured. Configure GMAIL_USER and GMAIL_APP_PASSWORD, then try again.',
      });
    }

    res.json({ message: successMessage });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// VERIFY RESET TOKEN ON INITIAL LOAD
router.get('/verify-reset-token/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const rawToken = Array.isArray(token) ? token[0] : token;

    if (!rawToken || typeof rawToken !== 'string') {
      return res.status(400).json({ error: 'Reset token is required' });
    }

    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    const user = await prisma.user.findFirst({
      where: {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      return res.status(400).json({ error: 'Password reset token is invalid or has expired' });
    }

    res.json({ message: 'Token is valid' });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({ error: 'Failed to verify reset token' });
  }
});

// RESET PASSWORD
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload. Password must be 12-72 characters.' });
    }
    const { token, newPassword } = parsed.data;

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await prisma.user.findFirst({
      where: {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      return res.status(400).json({ error: 'Password reset token is invalid or has expired' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    });

    res.json({ message: 'Password has been successfully reset. You can now log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// REFRESH ACCESS TOKEN AND ROTATE REFRESH TOKEN
router.post('/refresh', async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token required' });
  }

  let decoded: { userId: string };

  try {
    decoded = jwt.verify(
      refreshToken,
      getRefreshSecret()
    ) as { userId: string };
  } catch {
    return res.status(401).json({
      error: 'Invalid or expired refresh token',
    });
  }

  const now = new Date();
  const tokenHash = hashRefreshToken(refreshToken);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const storedToken = await tx.refreshToken.findUnique({
        where: { tokenHash },
      });

      if (
        !storedToken ||
        storedToken.userId !== decoded.userId ||
        storedToken.expiresAt <= now ||
        storedToken.consumedAt !== null ||
        storedToken.revokedAt !== null
      ) {
        return null;
      }

      const user = await tx.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, email: true },
      });

      if (!user) return null;

      // Atomically consume this token. Only one concurrent request
      // can change consumedAt from null to a timestamp.
      const consumed = await tx.refreshToken.updateMany({
        where: {
          id: storedToken.id,
          tokenHash,
          consumedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          consumedAt: now,
        },
      });

      if (consumed.count !== 1) {
        return null;
      }

      const nextRefreshToken = createRefreshToken(user.id);

      const nextToken = await tx.refreshToken.create({
        data: {
          userId: user.id,
          familyId: storedToken.familyId,
          tokenHash: hashRefreshToken(nextRefreshToken),
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        },
      });

      await tx.refreshToken.update({
        where: { id: storedToken.id },
        data: { replacedById: nextToken.id },
      });

      return {
        user,
        refreshToken: nextRefreshToken,
      };
    });

    if (!result) {
      return res.status(401).json({
        error: 'Refresh token is invalid, expired, or already used',
      });
    }

    const accessToken = createAccessToken(result.user);

    setRefreshTokenCookie(res, result.refreshToken);

    return res.json({ accessToken });
  } catch (error) {
    console.error('Refresh token error:', error);
    return res.status(500).json({
      error: 'Failed to refresh session',
    });
  }
});

// LOGOUT USER AND REVOKE THE CURRENT SESSION
router.post('/logout', async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.refreshToken;

  try {
    if (refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);

      const storedToken = await prisma.refreshToken.findUnique({
        where: { tokenHash },
        select: { familyId: true },
      });

      if (storedToken) {
        await prisma.refreshToken.updateMany({
          where: {
            familyId: storedToken.familyId,
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
          },
        });
      }
    }
  } catch (error) {
    console.error('Logout revocation error:', error);

    // Do not report a successful logout if server-side revocation failed.
    return res.status(500).json({
      error: 'Failed to revoke session',
    });
  } finally {
    // Clear the browser cookie even if the database operation fails.
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });
  }

  return res.json({ message: 'Logged out successfully' });
});

// GET LOGGED-IN USER PROFILE
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.userId },
      select: { id: true, email: true, createdAt: true },
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve profile' });
  }
});

export default router;
