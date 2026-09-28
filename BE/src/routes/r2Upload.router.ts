import { Router, Response } from 'express';
import {
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  ListPartsCommand, HeadObjectCommand, PutObjectCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { prisma } from '../lib/prisma.js';
import { getR2BucketName, getR2Client, getR2ObjectUrl } from '../config/r2.js';
import { redis } from '../config/redis.js';
import { randomUUID } from 'crypto';

const router = Router();
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 * 1024; // Enforce 50 GB limit
const MAX_PARTS = 10000;
const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
]);

// POST /api/upload/r2/presign (Single file <= 100MB)
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

    const uploadUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 900 });

    res.json({
      success: true,
      data: { uploadUrl, key: uniqueKey },
    });
  } catch (error) {
    console.error('Failed to generate R2 upload URL:', error);
    res.status(500).json({ error: 'Failed to generate pre-signed upload URL' });
  }
});

// POST /api/upload/r2/complete (Single file DB record)
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
      console.error('Failed to invalidate media gallery cache:', cacheError);
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

// POST /api/upload/r2/multipart/initiate
router.post('/r2/multipart/initiate', authenticateToken, uploadLimiter, async (req: AuthRequest, res: Response) => {
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

    const command = new CreateMultipartUploadCommand({
      Bucket: getR2BucketName(),
      Key: uniqueKey,
      ContentType: fileType,
    });

    const multipart = await getR2Client().send(command);

    res.json({
      success: true,
      data: { uploadId: multipart.UploadId, key: uniqueKey },
    });
  } catch (error) {
    console.error('Failed to initiate multipart upload:', error);
    res.status(500).json({ error: 'Failed to initiate multipart upload' });
  }
});

// GET /api/upload/r2/multipart/parts (Verify active multipart state on R2)
router.get('/r2/multipart/parts', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { key, uploadId } = req.query as { key: string; uploadId: string };
    const expectedPrefix = `vault/users/${userId}/`;

    if (!key?.startsWith(expectedPrefix) || !uploadId) {
      return res.status(400).json({ error: 'Invalid key or uploadId' });
    }

    const parts: { PartNumber: number; ETag: string }[] = [];
    let partNumberMarker: string | undefined;
    let isTruncated = true;
    while (isTruncated) {
      const response = await getR2Client().send(new ListPartsCommand({
        Bucket: getR2BucketName(), Key: key, UploadId: uploadId, PartNumberMarker: partNumberMarker,
      }));
      parts.push(...(response.Parts || []).flatMap((part) => part.PartNumber && part.ETag
        ? [{ PartNumber: part.PartNumber, ETag: part.ETag.replace(/"/g, '') }]
        : []));
      isTruncated = response.IsTruncated ?? false;
      partNumberMarker = response.NextPartNumberMarker;
    }

    res.json({ success: true, data: { parts } });
  } catch (error) {
    console.error('Failed to list parts:', error);
    res.status(400).json({ error: 'Multipart session expired or invalid' });
  }
});

// POST /api/upload/r2/multipart/presign-part
router.post('/r2/multipart/presign-part', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { key, uploadId, partNumber } = req.body;
    const expectedPrefix = `vault/users/${userId}/`;

    if (
      !key?.startsWith(expectedPrefix) ||
      !uploadId ||
      !Number.isSafeInteger(partNumber) ||
      partNumber < 1 ||
      partNumber > MAX_PARTS
    ) {
      return res.status(400).json({ error: 'Invalid multipart presign parameters' });
    }

    const command = new UploadPartCommand({
      Bucket: getR2BucketName(),
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });

    const presignedUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 900 });

    res.json({ success: true, data: { presignedUrl } });
  } catch (error) {
    console.error('Failed to presign upload part:', error);
    res.status(500).json({ error: 'Failed to generate part upload URL' });
  }
});

// POST /api/upload/r2/multipart/complete
router.post('/r2/multipart/complete', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { key, uploadId, parts, fileName, mimeType, fileSize: expectedFileSize } = req.body;
    const expectedPrefix = `vault/users/${userId}/`;

    if (
      !key?.startsWith(expectedPrefix) ||
      !uploadId ||
      typeof fileName !== 'string' || !fileName.trim() ||
      typeof mimeType !== 'string' || !ALLOWED_TYPES.has(mimeType) ||
      !Number.isSafeInteger(expectedFileSize) || expectedFileSize <= 0 || expectedFileSize > MAX_UPLOAD_BYTES ||
      !Array.isArray(parts) ||
      parts.length === 0 ||
      parts.length > MAX_PARTS
    ) {
      return res.status(400).json({ error: 'Invalid completion metadata' });
    }

    const uploadedParts = new Map<number, string>();
    let partNumberMarker: string | undefined;
    let isTruncated = true;
    while (isTruncated) {
      const listedParts = await getR2Client().send(new ListPartsCommand({
        Bucket: getR2BucketName(), Key: key, UploadId: uploadId, PartNumberMarker: partNumberMarker,
      }));
      for (const part of listedParts.Parts || []) {
        if (part.PartNumber && part.ETag) uploadedParts.set(part.PartNumber, part.ETag.replace(/"/g, ''));
      }
      isTruncated = listedParts.IsTruncated ?? false;
      partNumberMarker = listedParts.NextPartNumberMarker;
    }
    const requestedPartNumbers = new Set<number>();
    for (const part of parts) {
      if (!Number.isSafeInteger(part?.PartNumber) || part.PartNumber < 1 ||
          part.PartNumber > MAX_PARTS || typeof part.ETag !== 'string' ||
          requestedPartNumbers.has(part.PartNumber) ||
          uploadedParts.get(part.PartNumber) !== part.ETag.replace(/\"/g, '')) {
        return res.status(400).json({ error: 'Multipart parts do not match the uploaded parts' });
      }
      requestedPartNumbers.add(part.PartNumber);
    }
    if (requestedPartNumbers.size !== uploadedParts.size ||
        [...requestedPartNumbers].some((number) => !uploadedParts.has(number))) {
      return res.status(400).json({ error: 'Completion must include every uploaded part exactly once' });
    }
    const expectedPartCount = Math.ceil(MAX_UPLOAD_BYTES / (10 * 1024 * 1024));
    if (parts.length > expectedPartCount) {
      return res.status(400).json({ error: 'Too many multipart parts' });
    }

    const command = new CompleteMultipartUploadCommand({
      Bucket: getR2BucketName(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((p: { PartNumber: number; ETag: string }) => ({
          PartNumber: p.PartNumber,
          ETag: p.ETag,
        })),
      },
    });

    await getR2Client().send(command);

    const head = await getR2Client().send(new HeadObjectCommand({ Bucket: getR2BucketName(), Key: key }));
    const fileSize = head.ContentLength;
    if (typeof fileSize !== 'number' || !Number.isSafeInteger(fileSize) || fileSize !== expectedFileSize) {
      return res.status(400).json({ error: 'Uploaded file size does not match the upload session' });
    }

    const mediaType = mimeType.startsWith('video/') ? 'VIDEO' : 'IMAGE';

    const media = await prisma.media.create({
      data: {
        ownerId: userId,
        storageProvider: 'R2',
        cloudinaryAssetId: `r2:${key}`,
        publicId: key,
        secureUrl: null,
        originalFilename: fileName,
        mimeType,
        mediaType,
        bytes: fileSize || 0,
        status: 'READY',
      },
    });

    try {
      const keys = await redis.keys(`cache:media:user:${userId}:*`);
      if (keys.length) await redis.del(...keys);
    } catch (cacheError) {
      console.error('Failed to clear cache:', cacheError);
    }

    res.status(201).json({
      success: true,
      data: { ...media, deliveryUrl: await getR2ObjectUrl(key) },
    });
  } catch (error) {
    console.error('Failed to complete multipart upload:', error);
    res.status(500).json({ error: 'Failed to assemble multipart upload' });
  }
});

export default router;
