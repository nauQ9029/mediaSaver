import { Router, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { UploadApiResponse } from 'cloudinary';
import cloudinary from '../config/cloudinary.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { prisma } from '../lib/prisma.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per chunk limit
});

const TEMP_DIR = path.join(process.cwd(), 'tmp/uploads');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Enforce auth and rate limiting on ALL upload endpoints
router.use(authenticateToken);

router.get('/signature', uploadLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const timestamp = Math.round(new Date().getTime() / 1000);
    const userFolder = `vault/users/${userId}`;

    const paramsToSign = {
      timestamp,
      folder: userFolder,
      type: 'authenticated',
      media_metadata: false,
      allowed_formats: 'jpg,jpeg,png,webp,gif,mp4,webm,mov',
    };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET!
    );

    res.json({
      signature,
      timestamp,
      folder: userFolder,
      type: paramsToSign.type,
      mediaMetadata: paramsToSign.media_metadata,
      allowedFormats: paramsToSign.allowed_formats,
      apiKey: process.env.CLOUDINARY_API_KEY,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    });
  } catch (error) {
    console.error('Signature generation failed:', error);
    res.status(500).json({ error: 'Failed to generate upload signature' });
  }
});

// POST /api/upload/chunk/init
router.post('/chunk/init', uploadLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const { fileName, totalChunks } = req.body;
    if (!fileName || !totalChunks) {
      return res.status(400).json({ error: 'Missing fileName or totalChunks' });
    }

    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const sessionDir = path.join(TEMP_DIR, uploadId);

    fs.mkdirSync(sessionDir, { recursive: true });

    res.json({
      success: true,
      data: { uploadId, totalChunks, fileName },
    });
  } catch (error) {
    console.error('Failed to init chunk upload:', error);
    res.status(500).json({ error: 'Failed to initialize chunked upload session' });
  }
});

// POST /api/upload/chunk/upload
router.post('/chunk/upload', upload.single('chunk'), async (req: AuthRequest, res: Response) => {
  try {
    const { uploadId, chunkIndex } = req.body;
    const file = req.file;

    if (!file || !uploadId || chunkIndex === undefined) {
      return res.status(400).json({ error: 'Missing file chunk, uploadId, or chunkIndex' });
    }

    const sessionDir = path.join(TEMP_DIR, uploadId);
    if (!fs.existsSync(sessionDir)) {
      return res.status(404).json({ error: 'Upload session expired or invalid' });
    }

    const chunkPath = path.join(sessionDir, `chunk_${chunkIndex}`);
    fs.writeFileSync(chunkPath, file.buffer);

    res.json({ success: true, chunkIndex: Number(chunkIndex) });
  } catch (error) {
    console.error('Chunk upload write error:', error);
    res.status(500).json({ error: 'Failed to save chunk' });
  }
});

// POST /api/upload/chunk/complete
router.post('/chunk/complete', uploadLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { uploadId, fileName, totalChunks } = req.body;
    const sessionDir = path.join(TEMP_DIR, uploadId);
    const reassembledFilePath = path.join(TEMP_DIR, `${uploadId}_${fileName}`);

    if (!fs.existsSync(sessionDir)) {
      return res.status(400).json({ error: 'Invalid or missing upload session' });
    }

    // Reassemble chunks sequentially onto disk
    const writeStream = fs.createWriteStream(reassembledFilePath);

    for (let i = 0; i < Number(totalChunks); i++) {
      const chunkPath = path.join(sessionDir, `chunk_${i}`);
      if (!fs.existsSync(chunkPath)) {
        return res.status(400).json({ error: `Missing chunk ${i}` });
      }
      const buffer = fs.readFileSync(chunkPath);
      writeStream.write(buffer);
    }
    writeStream.end();

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // For local paths, upload_large returns a stream and reports the final
    // upload response through its callback.
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      cloudinary.uploader.upload_large(
        reassembledFilePath,
        {
          folder: `vault/users/${userId}`,
          type: 'authenticated',
          resource_type: 'auto',
          chunk_size: 20000000, // 20MB chunk size for Cloudinary
        },
        (error, response) => {
          if (error) return reject(error);
          if (!response) return reject(new Error('Cloudinary returned no upload response'));
          resolve(response);
        }
      );
    });

    if (!result.asset_id || !result.public_id || !result.secure_url || !result.resource_type) {
      throw new Error('Cloudinary upload response is missing required asset metadata');
    }

    // Save DB record
    const mediaType = result.resource_type === 'video' ? 'VIDEO' : 'IMAGE';

    const media = await prisma.media.create({
      data: {
        ownerId: userId,
        cloudinaryAssetId: result.asset_id,
        publicId: result.public_id,
        secureUrl: result.secure_url,
        originalFilename: fileName,
        mimeType: `${result.resource_type}/${result.format || 'octet-stream'}`,
        mediaType: mediaType,
        bytes: result.bytes,
        width: result.width || null,
        height: result.height || null,
        duration: result.duration || null,
        status: 'READY',
      },
    });

    // Cleanup temporary disk storage
    fs.rmSync(sessionDir, { recursive: true, force: true });
    if (fs.existsSync(reassembledFilePath)) {
      fs.unlinkSync(reassembledFilePath);
    }

    return res.status(201).json({ success: true, data: media });
  } catch (err) {
    console.error('Cloudinary upload/db error:', err);
    return res.status(500).json({ error: 'Failed to upload assembled file to cloud storage' });
  }
});

export default router;
