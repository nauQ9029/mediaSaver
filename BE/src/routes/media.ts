import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { MediaType, MediaStatus } from '../generated/prisma/client.js';
import cloudinary from '../config/cloudinary.js';
import { redis } from '../config/redis.js';
import { mediaQueue } from '../queues/mediaQueue.js';

const router = Router();

router.use(authenticateToken);

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const finalizeMediaSchema = z.object({
  publicId: z.string().min(1).max(500),
  resourceType: z.enum(['image', 'video']),
});

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

function withDeliveryUrl<T extends { publicId: string; mediaType: MediaType }>(media: T) {
  return {
    ...media,
    deliveryUrl: cloudinary.url(media.publicId, {
      resource_type: media.mediaType === MediaType.VIDEO ? 'video' : 'image',
      type: 'authenticated',
      sign_url: true,
      secure: true,
    }),
  };
}

// Save image or video metadata after successful Cloudinary direct upload
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = req.user?.userId;
    if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });

    const parsed = finalizeMediaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'A valid Cloudinary public ID is required' });
    }

    const { publicId, resourceType } = parsed.data;
    const expectedFolder = `vault/users/${ownerId}/`;
    if (!publicId.startsWith(expectedFolder)) {
      return res.status(403).json({ error: 'Media does not belong to this user folder' });
    }

    const asset = await cloudinary.api.resource(publicId, {
      resource_type: resourceType,
      type: 'authenticated',
    });

    if (!['image', 'video'].includes(asset.resource_type)) {
      return res.status(400).json({ error: 'Only images and videos are supported' });
    }

    if (!asset.asset_id || asset.bytes > MAX_UPLOAD_BYTES) {
      return res.status(400).json({ error: 'The uploaded file exceeds the allowed size' });
    }

    const mediaType = asset.resource_type === 'video' ? MediaType.VIDEO : MediaType.IMAGE;

    const media = await prisma.media.upsert({
      where: { publicId },
      update: {},
      create: {
        ownerId,
        cloudinaryAssetId: asset.asset_id,
        publicId,
        originalFilename: asset.original_filename || publicId.split('/').pop() || 'Untitled',
        mimeType: asset.format ? `${asset.resource_type}/${asset.format}` : asset.resource_type,
        mediaType,
        bytes: asset.bytes,
        width: asset.width ?? null,
        height: asset.height ?? null,
        duration: asset.duration ?? null,
        status: MediaStatus.READY,
      },
    });

    if (media.ownerId !== ownerId) {
      return res.status(409).json({ error: 'Media is already registered to another user' });
    }

    // Invalidate cached gallery views for this user
    await invalidateUserMediaCache(ownerId);

    // Offload asynchronous background task to BullMQ
    try {
      await mediaQueue.add('analyze-media', {
        mediaId: media.id,
        ownerId,
        publicId: media.publicId,
        action: 'PROCESS_METADATA',
      });
    } catch (queueErr) {
      console.error('Failed to dispatch BullMQ job:', queueErr);
      // Non-blocking: primary upload response completes even if background queue fails
    }

    res.status(201).json(withDeliveryUrl(media));
  } catch (error) {
    console.error('Save media error:', error);
    res.status(500).json({ error: 'Failed to save media metadata' });
  }
});

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
    const responseData = { data: media.map(withDeliveryUrl), nextCursor };

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

    res.json(withDeliveryUrl(updatedMedia));
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

    const format = media.mimeType.split('/')[1] || 'jpg';
    
    const downloadUrl = cloudinary.utils.private_download_url(
      media.publicId,
      format,
      {
        resource_type: media.mediaType === MediaType.VIDEO ? 'video' : 'image',
        type: 'authenticated',
        attachment: true,
      }
    );

    res.json({
      downloadUrl,
      filename: media.originalFilename,
    });
  } catch (error) {
    console.error('Download media error:', error);
    res.status(500).json({ error: 'Failed to generate download URL' });
  }
});

// Delete the Cloudinary asset before removing its database record
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

    const result = await cloudinary.uploader.destroy(media.publicId, {
      resource_type: media.mediaType === MediaType.VIDEO ? 'video' : 'image',
      type: 'authenticated',
      invalidate: true,
    });

    if (!['ok', 'not found'].includes(result.result)) {
      console.error('Cloudinary delete failed:', result);
      return res.status(502).json({ error: 'Failed to remove media from storage' });
    }

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