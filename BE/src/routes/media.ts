import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { MediaType, MediaStatus } from '../generated/prisma/client.js';
import cloudinary from '../config/cloudinary.js';

const router = Router();

router.use(authenticateToken);

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const finalizeMediaSchema = z.object({
  publicId: z.string().min(1).max(500),
  resourceType: z.enum(['image', 'video']),
});

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

    // Do not trust Cloudinary metadata supplied by the browser. Read it from
    // Cloudinary after upload, then enforce the server-side ownership policy.
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

    res.status(201).json(withDeliveryUrl(media));
  } catch (error) {
    console.error('Save media error:', error);
    res.status(500).json({ error: 'Failed to save media metadata' });
  }
});

// Cursor-based pagination for gallery grid
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = req.user?.userId;
    if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });

    const requestedLimit = Number(req.query.limit);
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 50)
      : 20;
    const cursor = req.query.cursor as string | undefined;

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

    res.json({ data: media.map(withDeliveryUrl), nextCursor });
  } catch (error) {
    console.error('Fetch media error:', error);
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

export default router;
