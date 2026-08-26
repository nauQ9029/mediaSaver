import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { MediaType, MediaStatus } from '../generated/prisma/client.js';

const router = Router();

router.use(authenticateToken);

// Save image or video metadata after successful Cloudinary direct upload
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = req.user?.userId;
    if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });

    const {
      cloudinaryAssetId,
      publicId,
      secureUrl,
      originalFilename,
      mimeType,
      mediaType,
      bytes,
      width,
      height,
      duration,
      takenAt,
      latitude,
      longitude,
    } = req.body;

    const media = await prisma.media.create({
      data: {
        ownerId,
        cloudinaryAssetId,
        publicId,
        secureUrl,
        originalFilename,
        mimeType,
        mediaType: mediaType === 'VIDEO' ? MediaType.VIDEO : MediaType.IMAGE,
        bytes,
        width: width || null,
        height: height || null,
        duration: duration || null,
        takenAt: takenAt ? new Date(takenAt) : null,
        latitude: latitude || null,
        longitude: longitude || null,
        status: MediaStatus.READY,
      },
    });

    res.status(201).json(media);
  } catch (error) {
    console.error('Save media error:', error);
    res.status(500).json({ error: 'Failed to save media metadata' });
  }
});

// Cursor-based pagination for gallery grid
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = req.user?.userId;
    const limit = parseInt(req.query.limit as string) || 20;
    const cursor = req.query.cursor as string | undefined;

    const media = await prisma.media.findMany({
      where: { ownerId },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' },
    });

    const nextCursor = media.length === limit ? media[media.length - 1].id : null;

    res.json({ data: media, nextCursor });
  } catch (error) {
    console.error('Fetch media error:', error);
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

export default router;
