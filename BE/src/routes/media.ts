import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getR2BucketName, getR2Client, getR2ObjectUrl } from '../config/r2.js';
import { redis } from '../config/redis.js';

const router = Router();

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
  publicId: string | null;
  storageProvider: string;
  secureUrl: string | null;
}>(media: T) {
  if (!media.publicId) {
    return { ...media, deliveryUrl: media.secureUrl ?? '' };
  }

  if (media.storageProvider === 'R2' && media.publicId) {
    return { ...media, deliveryUrl: await getR2ObjectUrl(media.publicId) };
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

// Delete the stored asset before removing its database record
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

    await getR2Client().send(new DeleteObjectCommand({
      Bucket: getR2BucketName(),
      Key: media.publicId,
    }));

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
