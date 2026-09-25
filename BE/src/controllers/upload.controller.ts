import { Response } from 'express';
import fs from 'fs';
import path from 'path';
import cloudinary from '../config/cloudinary.js';
import { prisma } from '../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';

const TEMP_DIR = path.join(process.cwd(), 'tmp/uploads');

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export const initiateChunkedUpload = async (req: AuthRequest, res: Response) => {
  try {
    const { fileName, totalChunks } = req.body;
    if (!fileName || !totalChunks) {
      return res.status(400).json({ error: 'Missing fileName or totalChunks' });
    }

    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const sessionDir = path.join(TEMP_DIR, uploadId);

    fs.mkdirSync(sessionDir, { recursive: true });

    return res.status(200).json({
      success: true,
      data: { uploadId, totalChunks, fileName },
    });
  } catch (error) {
    console.error('Initiate chunked upload error:', error);
    return res.status(500).json({ error: 'Failed to initialize chunked upload' });
  }
};

export const uploadChunk = async (req: AuthRequest, res: Response) => {
  try {
    const { uploadId, chunkIndex } = req.body;
    const file = req.file; // Provided by multer (@types/multer) via Express.Request

    if (!file || !uploadId || chunkIndex === undefined) {
      return res.status(400).json({ error: 'Missing chunk data' });
    }

    const sessionDir = path.join(TEMP_DIR, uploadId);
    if (!fs.existsSync(sessionDir)) {
      return res.status(404).json({ error: 'Upload session not found' });
    }

    const chunkPath = path.join(sessionDir, `chunk_${chunkIndex}`);
    fs.writeFileSync(chunkPath, file.buffer);

    return res.status(200).json({ success: true, chunkIndex: Number(chunkIndex) });
  } catch (error) {
    console.error('Upload chunk error:', error);
    return res.status(500).json({ error: 'Failed to write chunk' });
  }
};

export const completeChunkedUpload = async (req: AuthRequest, res: Response) => {
  try {
    const { uploadId, fileName, totalChunks } = req.body;
    const userId = req.user?.userId; // Using userId from your AuthRequest payload

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const sessionDir = path.join(TEMP_DIR, uploadId);
    const finalFilePath = path.join(TEMP_DIR, `${uploadId}_${fileName}`);

    if (!fs.existsSync(sessionDir)) {
      return res.status(400).json({ error: 'Missing or expired upload session' });
    }

    // Reassemble chunks sequentially
    const writeStream = fs.createWriteStream(finalFilePath);

    for (let i = 0; i < Number(totalChunks); i++) {
      const chunkPath = path.join(sessionDir, `chunk_${i}`);
      if (!fs.existsSync(chunkPath)) {
        return res.status(400).json({ error: `Missing chunk index ${i}` });
      }
      const buffer = fs.readFileSync(chunkPath);
      writeStream.write(buffer);
    }
    writeStream.end();

    writeStream.on('finish', async () => {
      try {
        // Stream reassembled file directly to Cloudinary
        const uploadResult = await cloudinary.uploader.upload(finalFilePath, {
          folder: `vault/users/${userId}`,
          type: 'authenticated',
          resource_type: 'auto',
        });

        // Map Cloudinary resource_type to your Prisma MediaType enum ('IMAGE' | 'VIDEO')
        const mediaType = uploadResult.resource_type === 'video' ? 'VIDEO' : 'IMAGE';

        // Persist metadata using your exact Prisma Media model fields
        const media = await prisma.media.create({
          data: {
            ownerId: userId,
            cloudinaryAssetId: uploadResult.asset_id,
            publicId: uploadResult.public_id,
            secureUrl: uploadResult.secure_url,
            originalFilename: fileName,
            mimeType: `${uploadResult.resource_type}/${uploadResult.format || 'octet-stream'}`,
            mediaType,
            bytes: uploadResult.bytes,
            width: uploadResult.width || null,
            height: uploadResult.height || null,
            duration: uploadResult.duration || null,
            status: 'READY',
          },
        });

        // Asynchronous disk cleanup
        fs.rmSync(sessionDir, { recursive: true, force: true });
        fs.unlinkSync(finalFilePath);

        return res.status(201).json({ success: true, data: media });
      } catch (err) {
        console.error('Cloudinary/Prisma processing error:', err);
        return res.status(500).json({ error: 'Failed to process assembled file' });
      }
    });
  } catch (error) {
    console.error('Complete chunked upload error:', error);
    return res.status(500).json({ error: 'Failed to assemble and finalize upload' });
  }
};