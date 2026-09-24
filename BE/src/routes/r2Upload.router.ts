import { Router, Response } from 'express';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { prisma } from '../lib/prisma.js';
import { getR2BucketName, getR2Client, getR2ObjectUrl } from '../config/r2.js';
import { redis } from '../config/redis.js';
import { randomUUID } from 'crypto';

const router = Router();
const MAX_UPLOAD_BYTES = 2000 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
]);

// POST /api/upload/r2/presign
router.post('/r2/presign', authenticateToken, uploadLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { fileName, fileType, fileSize } = req.body;
    if (
      typeof fileName !== 'string' || !fileName.trim() ||
      typeof fileType !== 'string' || !ALLOWED_TYPES.has(fileType) ||
      !Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_UPLOAD_BYTES
    ) {
      return res.status(400).json({ error: 'Invalid file name, type, or size' });
    }

    const uniqueKey = `vault/users/${userId}/${randomUUID()}`;

    const command = new PutObjectCommand({
      Bucket: getR2BucketName(),
      Key: uniqueKey,
      ContentType: fileType,
    });

    // Generate a 15-minute temporary presigned upload URL
    const uploadUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 900 });

    res.json({
      success: true,
      data: {
        uploadUrl,
        key: uniqueKey,
      },
    });
  } catch (error) {
    console.error('Failed to generate R2 upload URL:', error);
    res.status(500).json({ error: 'Failed to generate pre-signed upload URL' });
  }
});

// POST /api/upload/r2/complete (Saves record to Prisma)
router.post('/r2/complete', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { key, fileName, mimeType } = req.body;
    const expectedPrefix = `vault/users/${userId}/`;
    if (
      typeof key !== 'string' || !key.startsWith(expectedPrefix) ||
      typeof fileName !== 'string' || !fileName.trim() ||
      typeof mimeType !== 'string' || !ALLOWED_TYPES.has(mimeType)
    ) {
      return res.status(400).json({ error: 'Invalid uploaded media metadata' });
    }

    const head = await getR2Client().send(new HeadObjectCommand({
      Bucket: getR2BucketName(),
      Key: key,
    }));
    const fileSize = head.ContentLength;
    const storedMimeType = head.ContentType;
    if (
      typeof fileSize !== 'number' || !Number.isSafeInteger(fileSize) ||
      fileSize <= 0 || fileSize > MAX_UPLOAD_BYTES ||
      storedMimeType !== mimeType
    ) {
      return res.status(400).json({ error: 'Uploaded object size or type is invalid' });
    }

    const mediaType = storedMimeType.startsWith('video/') ? 'VIDEO' : 'IMAGE';

    const existingMedia = await prisma.media.findFirst({
      where: { publicId: key },
    });
    if (existingMedia && existingMedia.ownerId !== userId) {
      return res.status(409).json({ error: 'Uploaded object is already registered to another user' });
    }

    const media = existingMedia ?? await prisma.media.create({
      data: {
        ownerId: userId,
        storageProvider: 'R2',
        cloudinaryAssetId: `r2:${key}`,
        publicId: key,
        secureUrl: null,
        originalFilename: fileName,
        mimeType: storedMimeType,
        mediaType,
        bytes: fileSize,
        status: 'READY',
      },
    });

    try {
      const keys = await redis.keys(`cache:media:user:${userId}:*`);
      if (keys.length) await redis.del(...keys);
    } catch (cacheError) {
      console.error('Failed to invalidate media gallery cache after R2 upload:', cacheError);
    }

    res.status(201).json({
      success: true,
      data: { ...media, deliveryUrl: await getR2ObjectUrl(key) },
    });
  } catch (error) {
    console.error('Failed to save R2 metadata:', error);
    res.status(500).json({ error: 'Failed to record media metadata' });
  }
});

export default router;
