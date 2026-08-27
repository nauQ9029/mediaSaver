import { Router, Response } from 'express';
import cloudinary from '../config/cloudinary.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Enforce auth on ALL upload endpoints
router.use(authenticateToken);

router.get('/signature', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const timestamp = Math.round(new Date().getTime() / 1000);
    const userFolder = `vault/users/${userId}`;

    // Sever-approved upload constraints
    const paramsToSign = {
      timestamp,
      folder: userFolder,
      // Cloudinary upload parameters for restriction & metadata stripping
      type: 'authenticated', // Restrict public access on Cloudinary
      media_metadata: false, // Strip EXIF & GPS by default
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

export default router;
