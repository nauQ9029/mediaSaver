import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import {
  DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand,
  ListObjectsV2Command, PutObjectCommand,
} from '@aws-sdk/client-s3';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import sharp from 'sharp';
import { getR2BucketName, getR2Client, getR2ObjectUrl } from '../config/r2.js';
import { redis } from '../config/redis.js';

const router = Router();

const IMAGE_TRANSFORM_TOKEN_TTL_SECONDS = 15 * 60;
const MAX_TRANSFORM_SOURCE_BYTES = 32 * 1024 * 1024;
const IMAGE_TRANSFORM_TOKEN_PURPOSE = 'media-image-transform';
const ALLOWED_IMAGE_WIDTHS = new Set([16, 400, 800, 1200, 1600, 2048]);
const ALLOWED_IMAGE_QUALITIES = new Set([20, 80]);

function createImageTransformUrl(mediaId: string, ownerId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET must be configured');
  const token = jwt.sign(
    { mediaId, purpose: IMAGE_TRANSFORM_TOKEN_PURPOSE },
    secret,
    { subject: ownerId, expiresIn: IMAGE_TRANSFORM_TOKEN_TTL_SECONDS },
  );
  return `media/${encodeURIComponent(mediaId)}/transform?token=${encodeURIComponent(token)}`;
}

// Image elements cannot attach the in-memory bearer token, so gallery responses
// include a short-lived, media-scoped token for this one read-only route.
router.get('/:id/transform', async (req: AuthRequest, res: Response) => {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'Image transformation is unavailable' });

    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!token) return res.status(401).json({ error: 'Missing image access token' });

    let claims: JwtPayload;
    try {
      claims = jwt.verify(token, secret) as JwtPayload;
    } catch {
      return res.status(401).json({ error: 'Image access token is invalid or expired' });
    }

    const mediaId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ownerId = claims.sub;
    if (
      !mediaId || typeof ownerId !== 'string' ||
      claims.mediaId !== mediaId || claims.purpose !== IMAGE_TRANSFORM_TOKEN_PURPOSE
    ) {
      return res.status(403).json({ error: 'Image access token does not match this media' });
    }

    const media = await prisma.media.findFirst({
      where: { id: mediaId, ownerId },
      select: { id: true, publicId: true, storageProvider: true, mimeType: true },
    });
    if (!media) return res.status(404).json({ error: 'Media not found' });
    if (media.storageProvider !== 'R2' || !media.publicId || !media.mimeType.startsWith('image/')) {
      return res.status(415).json({ error: 'Only R2 images can be transformed' });
    }

    const width = Number(req.query.width ?? 800);
    const quality = Number(req.query.quality ?? 80);
    const format = typeof req.query.format === 'string' ? req.query.format : 'webp';
    if (
      !Number.isSafeInteger(width) || !ALLOWED_IMAGE_WIDTHS.has(width) ||
      !Number.isSafeInteger(quality) || !ALLOWED_IMAGE_QUALITIES.has(quality) ||
      (format !== 'webp' && format !== 'avif' && format !== 'jpeg')
    ) {
      return res.status(400).json({ error: 'Invalid image transformation options' });
    }

    const variantKey = `vault/users/${ownerId}/.variants/${media.id}/w${width}-q${quality}.${format}`;
    const client = getR2Client();
    try {
      await client.send(new HeadObjectCommand({ Bucket: getR2BucketName(), Key: variantKey }));
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.redirect(302, await getR2ObjectUrl(variantKey));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 404 && (error as Error).name !== 'NotFound' && (error as Error).name !== 'NoSuchKey') {
        throw error;
      }
    }

    const originalHead = await client.send(new HeadObjectCommand({
      Bucket: getR2BucketName(), Key: media.publicId,
    }));
    const sourceSize = originalHead.ContentLength;
    if (!Number.isSafeInteger(sourceSize) || !sourceSize || sourceSize > MAX_TRANSFORM_SOURCE_BYTES) {
      return res.status(413).json({ error: 'Image is too large to transform' });
    }

    const original = await client.send(new GetObjectCommand({
      Bucket: getR2BucketName(), Key: media.publicId,
    }));
    if (!original.Body) return res.status(404).json({ error: 'Image object not found' });

    const sourceBuffer = Buffer.from(await original.Body.transformToByteArray());
    const transformed = await sharp(sourceBuffer, { limitInputPixels: 100_000_000 })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .toFormat(format, { quality })
      .toBuffer();

    await client.send(new PutObjectCommand({
      Bucket: getR2BucketName(),
      Key: variantKey,
      Body: transformed,
      ContentType: `image/${format}`,
      CacheControl: 'private, max-age=86400, immutable',
    }));

    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.redirect(302, await getR2ObjectUrl(variantKey));
  } catch (error) {
    console.error('Image transformation failed:', error);
    return res.status(500).json({ error: 'Failed to transform image' });
  }
});

router.use(authenticateToken);

const updateMediaSchema = z.object({
  originalFilename: z.string().trim().min(1).max(255).optional(),
});

// Cache key helper: isolate cache per user, limit, and cursor
const getMediaCacheKey = (ownerId: string, limit: number, cursor: string = 'none') =>
  `cache:media:user:${ownerId}:l:${limit}:c:${cursor}`;

// Helper to invalidate all pagination cache keys for a specific user
async function invalidateUserMediaCache(ownerId: string): Promise<void> {
  try {
    const pattern = `cache:media:user:${ownerId}:*`;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (err) {
    console.error('Failed to invalidate Redis media cache:', err);
  }
}

async function withDeliveryUrl<T extends {
  id: string;
  ownerId: string;
  mediaType: string;
  publicId: string | null;
  storageProvider: string;
  secureUrl: string | null;
}>(media: T) {
  if (!media.publicId) {
    return { ...media, deliveryUrl: media.secureUrl ?? '' };
  }

  if (media.storageProvider === 'R2' && media.publicId) {
    return {
      ...media,
      deliveryUrl: await getR2ObjectUrl(media.publicId),
      ...(media.mediaType === 'IMAGE'
        ? { imageTransformUrl: createImageTransformUrl(media.id, media.ownerId) }
        : {}),
    };
  }

  // Legacy Cloudinary rows may not have a direct URL. Keep them renderable
  // without requiring Cloudinary configuration; they need to be migrated to R2.
  return { ...media, deliveryUrl: media.secureUrl ?? '' };
}

router.post('/', (_req: AuthRequest, res: Response) =>
  res.status(410).json({ error: 'Direct media registration is disabled; upload through R2.' })
);

// Cursor-based pagination for gallery grid with Redis Caching
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = req.user?.userId;
    if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });

    const requestedLimit = Number(req.query.limit);
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 50)
      : 20;
    const cursor = req.query.cursor as string | undefined;

    const cacheKey = getMediaCacheKey(ownerId, limit, cursor);

    // 1. Attempt Cache Lookup
    try {
      const cachedResult = await redis.get(cacheKey);
      if (cachedResult) {
        return res.json(JSON.parse(cachedResult));
      }
    } catch (cacheErr) {
      console.error('Redis GET error:', cacheErr);
      // Fallback to DB on Redis connection/query failures
    }

    // 2. Validate Cursor & Fetch from Database
    if (cursor) {
      const cursorMedia = await prisma.media.findFirst({
        where: { id: cursor, ownerId },
        select: { id: true },
      });
      if (!cursorMedia) return res.status(400).json({ error: 'Invalid cursor' });
    }

    const media = await prisma.media.findMany({
      where: { ownerId },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const nextCursor = media.length === limit ? media[media.length - 1].id : null;
    const responseData = { data: await Promise.all(media.map(withDeliveryUrl)), nextCursor };

    // 3. Write payload to Redis with a 300-second (5 min) TTL
    try {
      await redis.setex(cacheKey, 300, JSON.stringify(responseData));
    } catch (cacheErr) {
      console.error('Redis SETEX error:', cacheErr);
    }

    res.json(responseData);
  } catch (error) {
    console.error('Fetch media error:', error);
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

// Update media metadata (e.g. rename file)
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = req.user?.userId;
    if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });

    const mediaId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!mediaId) return res.status(400).json({ error: 'A valid media ID is required' });

    const parsed = updateMediaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid metadata updates provided' });
    }

    const media = await prisma.media.findFirst({
      where: { id: mediaId, ownerId },
    });
    if (!media) return res.status(404).json({ error: 'Media not found' });

    const updatedMedia = await prisma.media.update({
      where: { id: media.id },
      data: parsed.data,
    });

    // Invalidate cached gallery views for this user
    await invalidateUserMediaCache(ownerId);

    res.json(await withDeliveryUrl(updatedMedia));
  } catch (error) {
    console.error('Update media error:', error);
    res.status(500).json({ error: 'Failed to update media' });
  }
});

// Generate download link for original full-resolution media
router.get('/:id/download', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = req.user?.userId;
    if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });

    const mediaId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!mediaId) return res.status(400).json({ error: 'A valid media ID is required' });

    const media = await prisma.media.findFirst({
      where: { id: mediaId, ownerId },
    });
    if (!media) return res.status(404).json({ error: 'Media not found' });
    if (!media.publicId) return res.status(409).json({ error: 'Media storage reference is missing' });

    if (media.storageProvider !== 'R2') {
      return res.status(410).json({ error: 'This legacy media item must be migrated to R2 before downloading' });
    }
    const downloadUrl = await getR2ObjectUrl(media.publicId, media.originalFilename);

    res.json({
      downloadUrl,
      filename: media.originalFilename,
    });
  } catch (error) {
    console.error('Download media error:', error);
    res.status(500).json({ error: 'Failed to generate download URL' });
  }
});

// Delete variants first, then the stored asset, before removing its database record.
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = req.user?.userId;
    if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });

    const mediaId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!mediaId) return res.status(400).json({ error: 'A valid media ID is required' });

    const media = await prisma.media.findFirst({
      where: { id: mediaId, ownerId },
    });
    if (!media) return res.status(404).json({ error: 'Media not found' });
    if (!media.publicId) return res.status(409).json({ error: 'Media storage reference is missing' });

    if (media.storageProvider !== 'R2') {
      return res.status(410).json({ error: 'This legacy media item must be migrated to R2 before deleting' });
    }

    const r2 = getR2Client();
    const bucket = getR2BucketName();
    let continuationToken: string | undefined;
    do {
      const variants = await r2.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `vault/users/${ownerId}/.variants/${media.id}/`,
        ContinuationToken: continuationToken,
      }));
      const variantObjects = (variants.Contents || []).flatMap((object) =>
        object.Key ? [{ Key: object.Key }] : [],
      );
      if (variantObjects.length) {
        const deletion = await r2.send(new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: variantObjects },
        }));
        if (deletion.Errors?.length) {
          throw new Error(`R2 failed to delete ${deletion.Errors.length} transformed variant(s)`);
        }
      }
      continuationToken = variants.IsTruncated ? variants.NextContinuationToken : undefined;
    } while (continuationToken);

    // Confirm the prefix is empty before deleting the original. This also catches
    // objects that were omitted from a failed or incomplete batch response.
    const remainingVariants = await r2.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `vault/users/${ownerId}/.variants/${media.id}/`,
      MaxKeys: 1,
    }));
    if (remainingVariants.Contents?.some((object) => object.Key)) {
      throw new Error('R2 transformed variants remain after cleanup');
    }

    await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: media.publicId }));
    await prisma.media.delete({ where: { id: media.id } });

    // Invalidate cached gallery views for this user
    await invalidateUserMediaCache(ownerId);

    res.status(204).send();
  } catch (error) {
    console.error('Delete media error:', error);
    res.status(500).json({ error: 'Failed to delete media' });
  }
});

export default router;
