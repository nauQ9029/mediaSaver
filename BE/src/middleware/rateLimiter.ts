import rateLimit from 'express-rate-limit';

// Strict limiter for Auth endpoints (Login, Register, Password Reset)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again after 15 minutes.' },
});

// Moderated limiter for Media Uploads
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // Limit each IP to 30 uploads per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Upload limit exceeded. Please try again later.' },
});