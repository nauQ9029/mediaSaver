import { Router, Request, Response } from 'express';
import cloudinary from '../config/cloudinary.js';

const router = Router();

router.get('/signature', (req: Request, res: Response) => {
  const timestamp = Math.round(new Date().getTime() / 1000);
  const folder = 'user_uploads';

  // Parameters to sign
  const paramsToSign = {
    timestamp,
    folder,
  };

  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    process.env.CLOUDINARY_API_SECRET!
  );

  res.json({
    signature,
    timestamp,
    folder,
    apiKey: process.env.CLOUDINARY_API_KEY,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
  });
});

export default router;