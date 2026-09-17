// Database seeds, JWT generators, mock factory
import jwt from 'jsonwebtoken';
import { prisma } from '../src/lib/prisma'; // Adjust import to your Prisma client location

export const generateAuthToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' });
};

export const generateExpiredToken = () => {
  return jwt.sign({ userId: 'expired-user' }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '-1s' });
};

export const createTestUser = async (overrides = {}) => {
  return await prisma.user.create({
    data: {
      email: `test-${Date.now()}-${Math.random()}@vault.local`,
      password: '$2a$10$e8R4a0S0gL.J2Z5J9nJb2.u8eZqJqK0Z5J9nJb2.u8eZqJqK0Z5J', // Changed passwordHash -> password
      ...overrides,
    },
  });
};

export const createTestMedia = async (data) => {
  return await prisma.media.create({
    data: {
      cloudinaryAssetId: `asset-${Math.random()}`,
      publicId: `public-${Math.random()}`,
      originalFilename: 'test_file.jpg',
      mimeType: 'image/jpeg',
      mediaType: 'IMAGE',
      bytes: 1024,
      status: 'READY',
      ...data,
    },
  });
};