import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';

const router = Router();

// Save image or video metadata after successful Cloudinary direct upload
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      ownerId,
      cloudinaryAssetId,
      publicId,
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
        originalFilename,
        mimeType,
        mediaType,
        bytes,
        width,
        height,
        duration,
        takenAt: takenAt ? new Date(takenAt) : null,
        latitude,
        longitude,
      },
    });

    res.status(201).json(media);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save media metadata' });
  }
});

// Cursor-based pagination for gallery grid
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const cursor = req.query.cursor as string | undefined;

    const media = await prisma.media.findMany({
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' },
    });

    const nextCursor = media.length === limit ? media[media.length - 1].id : null;

    res.json({ data: media, nextCursor });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

export default router;
