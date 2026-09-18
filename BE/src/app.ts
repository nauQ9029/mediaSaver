import cors from 'cors';
import dotenv from 'dotenv';
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
const clientUrl = process.env.CLIENT_ORIGIN ?? process.env.CLIENT_URL ?? 'http://localhost:5173';

app.use(cors({ origin: clientUrl, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/media', mediaRoutes);

app.get('/api/health', (_request: Request, response: Response) => {
  response.json({ status: 'ok', message: 'Backend is running' });
});

export default app;