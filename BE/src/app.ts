import cors from 'cors';
import dotenv from 'dotenv';
import * as Sentry from '@sentry/node';
import express, { type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth.js';
import mediaRoutes from './routes/media.js';
import uploadRoutes from './routes/upload.js';

dotenv.config();

for (const variable of [
  'DATABASE_URL',
  'JWT_SECRET',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
]) {
  if (!process.env[variable]) {
    throw new Error(`Missing required environment variable: ${variable}`);
  }
}

const app = express();

// initialize Sentry before routes
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 1.0,
  });
}

const clientUrl = process.env.CLIENT_ORIGIN ?? process.env.CLIENT_URL ?? 'http://localhost:5173';

app.use(cors({ origin: clientUrl, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// application routes
app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/media', mediaRoutes);

app.get('/api/health', (_request: Request, response: Response) => {
  response.json({ status: 'ok', message: 'Backend is running' });
});

// Sentry Express Error Handler (must be registered AFTER all controllers/routes)
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

export default app;