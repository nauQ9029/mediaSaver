import { Router, Response } from 'express';
import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  ListPartsCommand,
  HeadObjectCommand,
  PutObjectCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { prisma } from '../lib/prisma.js';
import { getR2BucketName, getR2Client, getR2ObjectUrl } from '../config/r2.js';
import { redis } from '../config/redis.js';
import { enqueueMediaMetadata } from '../queues/mediaQueue.js';
import { randomUUID } from 'crypto';

const router = Router();
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 * 1024; // Enforce 50 GB limit
const MAX_PARTS = 10000;
const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
]);


type ActiveMultipartSessionResult =
  | { session: { id: string; userId: string; key: string; uploadId: string; fileName: string; fileType: string; fileSize: bigint; expiresAt: Date }; error?: never }
  | { session?: never; error: 'NOT_FOUND' | 'EXPIRED' | 'INACTIVE' };

async function requireActiveMultipartSession(
  userId: string,
  key: unknown,
  uploadId: unknown,
): Promise<ActiveMultipartSessionResult> {
  if (
    typeof key !== 'string' ||
    typeof uploadId !== 'string' ||
    !key.startsWith(`vault/users/${userId}/`) ||
    !uploadId.trim()
  ) {
    return { error: 'NOT_FOUND' };
  }

  const session = await prisma.multipartUploadSession.findUnique({
    where: { uploadId },
    select: {
      id: true,
      userId: true,
      key: true,
      uploadId: true,
      fileName: true,
      fileType: true,
      fileSize: true,
      status: true,
      expiresAt: true,
    },
  });

  // Do not reveal whether another user's session exists.
  if (!session || session.userId !== userId || session.key !== key) {
    return { error: 'NOT_FOUND' };
  }

  if (session.status !== 'ACTIVE') {
    return { error: 'INACTIVE' };
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    return { error: 'EXPIRED' };
  }

  return {
    session: {
      id: session.id,
      userId: session.userId,
      key: session.key,
      uploadId: session.uploadId,
      fileName: session.fileName,
      fileType: session.fileType,
      fileSize: session.fileSize,
      expiresAt: session.expiresAt,
    },
  };
}

function respondToSessionError(
  res: Response,
  error: 'NOT_FOUND' | 'EXPIRED' | 'INACTIVE',
) {
  if (error === 'NOT_FOUND') {
    return res.status(404).json({ error: 'Multipart session not found' });
  }

  if (error === 'EXPIRED') {
    return res.status(410).json({ error: 'Multipart session expired' });
  }

  return res.status(409).json({ error: 'Multipart session is no longer active' });
}

// POST /api/upload/r2/presign (Single file <= 100MB)
router.post('/r2/presign', authenticateToken, uploadLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { fileName, fileType, fileSize } = req.body;
    if (
      typeof fileName !== 'string' || !fileName.trim() ||
      typeof fileType !== 'string' || !ALLOWED_TYPES.has(fileType) ||
      !Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_UPLOAD_BYTES
    ) {
      return res.status(400).json({ error: 'Invalid file name, type, or size' });
    }

    const uniqueKey = `vault/users/${userId}/${randomUUID()}`;

    const command = new PutObjectCommand({
      Bucket: getR2BucketName(),
      Key: uniqueKey,
      ContentType: fileType,
    });

    const uploadUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 900 });

    res.json({
      success: true,
      data: { uploadUrl, key: uniqueKey },
    });
  } catch (error) {
    console.error('Failed to generate R2 upload URL:', error);
    res.status(500).json({ error: 'Failed to generate pre-signed upload URL' });
  }
});

// POST /api/upload/r2/complete (Single file DB record)
router.post('/r2/complete', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { key, fileName, mimeType } = req.body;
    const expectedPrefix = `vault/users/${userId}/`;
    if (
      typeof key !== 'string' || !key.startsWith(expectedPrefix) ||
      typeof fileName !== 'string' || !fileName.trim() ||
      typeof mimeType !== 'string' || !ALLOWED_TYPES.has(mimeType)
    ) {
      return res.status(400).json({ error: 'Invalid uploaded media metadata' });
    }

    const head = await getR2Client().send(new HeadObjectCommand({
      Bucket: getR2BucketName(),
      Key: key,
    }));
    const fileSize = head.ContentLength;
    const storedMimeType = head.ContentType;
    if (
      typeof fileSize !== 'number' || !Number.isSafeInteger(fileSize) ||
      fileSize <= 0 || fileSize > MAX_UPLOAD_BYTES ||
      storedMimeType !== mimeType
    ) {
      return res.status(400).json({ error: 'Uploaded object size or type is invalid' });
    }

    const mediaType = storedMimeType.startsWith('video/') ? 'VIDEO' : 'IMAGE';

    const existingMedia = await prisma.media.findFirst({
      where: { publicId: key },
    });
    if (existingMedia && existingMedia.ownerId !== userId) {
      return res.status(409).json({ error: 'Uploaded object is already registered to another user' });
    }

    let media = existingMedia ?? await prisma.media.create({
      data: {
        ownerId: userId,
        storageProvider: 'R2',
        cloudinaryAssetId: `r2:${key}`,
        publicId: key,
        secureUrl: null,
        originalFilename: fileName,
        mimeType: storedMimeType,
        mediaType,
        bytes: fileSize,
        status: 'PENDING',
      },
    });

    if (media.status === 'FAILED') {
      media = await prisma.media.update({ where: { id: media.id }, data: { status: 'PENDING' } });
    }
    await enqueueMediaMetadata(media);

    try {
      const keys = await redis.keys(`cache:media:user:${userId}:*`);
      if (keys.length) await redis.del(...keys);
    } catch (cacheError) {
      console.error('Failed to invalidate media gallery cache:', cacheError);
    }

    // Completion is idempotent: retries return the same persisted media result.
    res.json({
      success: true,
      data: { ...media, deliveryUrl: await getR2ObjectUrl(key) },
    });
  } catch (error) {
    console.error('Failed to save R2 metadata:', error);
    res.status(500).json({ error: 'Failed to record media metadata' });
  }
});

// POST /api/upload/r2/multipart/initiate
router.post('/r2/multipart/initiate', authenticateToken, uploadLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { fileName, fileType, fileSize } = req.body;
    if (
      typeof fileName !== 'string' || !fileName.trim() ||
      typeof fileType !== 'string' || !ALLOWED_TYPES.has(fileType) ||
      !Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_UPLOAD_BYTES
    ) {
      return res.status(400).json({ error: 'Invalid file name, type, or size' });
    }

    const key = `vault/users/${userId}/${randomUUID()}`;

    // create the multipart upload on R2
    const multipart = await getR2Client().send(
      new CreateMultipartUploadCommand({
        Bucket: getR2BucketName(),
        Key: key,
        ContentType: fileType,
      }),
    );

    const uploadId = multipart.UploadId;

    if (!uploadId) {
      console.error('R2 did not return an upload ID');

      return res.status(502).json({
        error: 'R2 did not return a multipart upload ID',
      });
    }

    // persist the session only after R2 returns an upload ID.
    try {
      await prisma.multipartUploadSession.create({
        data: {
          userId,
          uploadId,
          key,
          fileName: fileName.trim(),
          fileType,
          fileSize: BigInt(fileSize),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    } catch (dbError) {
      // R2 and PostgreSQL are separate systems
      // try to clean up the R2 upload if session persistence fails
      try {
        await getR2Client().send(
          new AbortMultipartUploadCommand({
            Bucket: getR2BucketName(),
            Key: key,
            UploadId: uploadId,
          }),
        );
      } catch (abortError) {
        console.error(
          'Failed to abort orphaned R2 multipart upload:',
          abortError,
        );
      }

      throw dbError;
    }

    // preserve the response expected by the frontend.
    return res.status(201).json({
      success: true,
      data: { uploadId, key },
    });
  } catch (error) {
    console.error('Failed to initiate multipart upload:', error);

    return res.status(500).json({
      error: 'Failed to initiate multipart upload',
    });
  }
},
);

// GET /api/upload/r2/multipart/parts (Verify active multipart state on R2)
router.get('/r2/multipart/parts', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { key, uploadId } = req.query as { key: string; uploadId: string };
    const expectedPrefix = `vault/users/${userId}/`;

    if (!key?.startsWith(expectedPrefix) || !uploadId) {
      return res.status(400).json({ error: 'Invalid key or uploadId' });
    }

    const result = await requireActiveMultipartSession(userId, key, uploadId);

    if (result.error) {
      return respondToSessionError(res, result.error);
    }

    const parts: { PartNumber: number; ETag: string }[] = [];
    let partNumberMarker: string | undefined;
    let isTruncated = true;
    while (isTruncated) {
      const response = await getR2Client().send(new ListPartsCommand({
        Bucket: getR2BucketName(), Key: key, UploadId: uploadId, PartNumberMarker: partNumberMarker,
      }));
      parts.push(...(response.Parts || []).flatMap((part) => part.PartNumber && part.ETag
        ? [{ PartNumber: part.PartNumber, ETag: part.ETag.replace(/"/g, '') }]
        : []));
      isTruncated = response.IsTruncated ?? false;
      partNumberMarker = response.NextPartNumberMarker;
    }

    res.json({
      success: true,
      data: {
        parts,
        completed: false,
        session: {
          fileName: result.session.fileName,
          fileType: result.session.fileType,
          fileSize: Number(result.session.fileSize),
          expiresAt: result.session.expiresAt,
        },
      },
    });
  } catch (error) {
    console.error('Failed to list parts:', error);
    const r2Error = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (r2Error.name === 'NoSuchUpload' || r2Error.$metadata?.httpStatusCode === 404) {
      const userId = req.user?.userId;
      const { key, uploadId } = req.query as { key?: string; uploadId?: string };
      if (userId && key && uploadId) {
        try {
          const session = await prisma.multipartUploadSession.findUnique({
            where: { uploadId },
            select: { id: true, userId: true, key: true, fileName: true, fileType: true, fileSize: true, status: true },
          });
          if (session?.userId === userId && session.key === key && session.status === 'ACTIVE') {
            try {
              const head = await getR2Client().send(new HeadObjectCommand({ Bucket: getR2BucketName(), Key: key }));
              if (
                head.ContentLength === Number(session.fileSize) &&
                head.ContentType === session.fileType
              ) {
                return res.json({
                  success: true,
                  data: {
                    parts: [],
                    completed: true,
                    session: {
                      fileName: session.fileName,
                      fileType: session.fileType,
                      fileSize: Number(session.fileSize),
                      expiresAt: null,
                    },
                  },
                });
              }
            } catch (headError) {
              const objectError = headError as { name?: string; $metadata?: { httpStatusCode?: number } };
              if (objectError.name !== 'NotFound' && objectError.$metadata?.httpStatusCode !== 404) throw headError;
            }

            await prisma.multipartUploadSession.updateMany({
              where: { id: session.id, status: 'ACTIVE' },
              data: { status: 'ABORTED', abortedAt: new Date() },
            });
          }
        } catch (dbError) {
          console.error('Could not reconcile missing multipart upload:', dbError);
          return res.status(500).json({ error: 'Failed to reconcile multipart upload state' });
        }
      }
      return res.status(410).json({ error: 'Multipart upload no longer exists on storage' });
    }
    return res.status(500).json({ error: 'Failed to retrieve multipart upload progress' });
  }
});

// POST /api/upload/r2/multipart/presign-part
router.post('/r2/multipart/presign-part', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { key, uploadId, partNumber } = req.body;
    const expectedPrefix = `vault/users/${userId}/`;

    if (
      !key?.startsWith(expectedPrefix) ||
      !uploadId ||
      !Number.isSafeInteger(partNumber) ||
      partNumber < 1 ||
      partNumber > MAX_PARTS
    ) {
      return res.status(400).json({ error: 'Invalid multipart presign parameters' });
    }

    const result = await requireActiveMultipartSession(userId, key, uploadId);

    if (result.error) {
      return respondToSessionError(res, result.error);
    }

    const command = new UploadPartCommand({
      Bucket: getR2BucketName(),
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });

    const presignedUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 900 });

    res.json({ success: true, data: { presignedUrl } });
  } catch (error) {
    console.error('Failed to presign upload part:', error);
    res.status(500).json({ error: 'Failed to generate part upload URL' });
  }
});

// POST /api/upload/r2/multipart/complete
router.post('/r2/multipart/complete', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { key, uploadId, parts, fileName, mimeType, fileSize: expectedFileSize } = req.body;
    const expectedPrefix = `vault/users/${userId}/`;

    if (
      !key?.startsWith(expectedPrefix) ||
      !uploadId ||
      typeof fileName !== 'string' || !fileName.trim() ||
      typeof mimeType !== 'string' || !ALLOWED_TYPES.has(mimeType) ||
      !Number.isSafeInteger(expectedFileSize) || expectedFileSize <= 0 || expectedFileSize > MAX_UPLOAD_BYTES ||
      !Array.isArray(parts) ||
      parts.length > MAX_PARTS
    ) {
      return res.status(400).json({ error: 'Invalid completion metadata' });
    }

    const result = await requireActiveMultipartSession(userId, key, uploadId);

    if (result.error) {
      if (result.error === 'INACTIVE') {
        const completedSession = await prisma.multipartUploadSession.findUnique({
          where: { uploadId },
          select: { userId: true, key: true, status: true, fileName: true, fileType: true, fileSize: true },
        });
        if (
          completedSession?.userId === userId &&
          completedSession.key === key &&
          completedSession.status === 'COMPLETED' &&
          completedSession.fileName === fileName.trim() &&
          completedSession.fileType === mimeType &&
          completedSession.fileSize === BigInt(expectedFileSize)
        ) {
          let media = await prisma.media.findFirst({
            where: { ownerId: userId, OR: [{ multipartUploadId: uploadId }, { publicId: key }] },
          });
          if (media) {
            if (media.status === 'FAILED') {
              media = await prisma.media.update({ where: { id: media.id }, data: { status: 'PENDING' } });
            }
            await enqueueMediaMetadata(media);
            return res.json({
              success: true,
              data: { ...media, deliveryUrl: await getR2ObjectUrl(key) },
            });
          }
        }
      }
      return respondToSessionError(res, result.error);
    }

    if (
      result.session.fileName !== fileName.trim() ||
      result.session.fileType !== mimeType ||
      result.session.fileSize !== BigInt(expectedFileSize)
    ) {
      return res.status(400).json({ error: 'Completion metadata does not match the upload session' });
    }

    let alreadyCompleted = false;
    const uploadedParts = new Map<number, string>();
    let partNumberMarker: string | undefined;
    let isTruncated = true;
    try {
      while (isTruncated) {
        const listedParts = await getR2Client().send(new ListPartsCommand({
          Bucket: getR2BucketName(), Key: key, UploadId: uploadId, PartNumberMarker: partNumberMarker,
        }));
        for (const part of listedParts.Parts || []) {
          if (part.PartNumber && part.ETag) uploadedParts.set(part.PartNumber, part.ETag.replace(/"/g, ''));
        }
        isTruncated = listedParts.IsTruncated ?? false;
        partNumberMarker = listedParts.NextPartNumberMarker;
      }
    } catch (error) {
      const r2Error = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (r2Error.name !== 'NoSuchUpload' && r2Error.$metadata?.httpStatusCode !== 404) throw error;
      alreadyCompleted = true;
    }

    if (!alreadyCompleted) {
      const requestedPartNumbers = new Set<number>();
      let previousPartNumber = 0;

      for (const part of parts) {
        if (
          !Number.isSafeInteger(part?.PartNumber) ||
          part.PartNumber < 1 ||
          part.PartNumber > MAX_PARTS ||
          typeof part.ETag !== 'string' ||
          requestedPartNumbers.has(part.PartNumber) ||
          part.PartNumber <= previousPartNumber ||
          uploadedParts.get(part.PartNumber) !== part.ETag.replace(/"/g, '')
        ) {
          return res.status(400).json({ error: 'Multipart parts do not match the uploaded parts' });
        }

        requestedPartNumbers.add(part.PartNumber);
        previousPartNumber = part.PartNumber;
      }
      if (parts.length === 0 || requestedPartNumbers.size !== uploadedParts.size ||
        [...requestedPartNumbers].some((number) => !uploadedParts.has(number))) {
        return res.status(400).json({ error: 'Completion must include every uploaded part exactly once' });
      }

      if (parts.length > MAX_PARTS) {
        return res.status(400).json({ error: 'Too many multipart parts' });
      }

      const command = new CompleteMultipartUploadCommand({
        Bucket: getR2BucketName(),
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((p: { PartNumber: number; ETag: string }) => ({
            PartNumber: p.PartNumber,
            ETag: `"${p.ETag.replace(/"/g, '')}"`,
          })),
        },
      });

      try {
        await getR2Client().send(command);
      } catch (error) {
        const r2Error = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (r2Error.name !== 'NoSuchUpload' && r2Error.$metadata?.httpStatusCode !== 404) throw error;
        alreadyCompleted = true;
      }
    }

    const head = await getR2Client().send(new HeadObjectCommand({ Bucket: getR2BucketName(), Key: key }));
    const fileSize = head.ContentLength;
    if (
      typeof fileSize !== 'number' || !Number.isSafeInteger(fileSize) ||
      fileSize !== expectedFileSize || head.ContentType !== mimeType
    ) {
      return res.status(400).json({ error: 'Uploaded object size or type does not match the upload session' });
    }

    const mediaType = mimeType.startsWith('video/') ? 'VIDEO' : 'IMAGE';

    let media = await prisma.media.findFirst({ where: { multipartUploadId: uploadId } });
    media ??= await prisma.media.findFirst({
      where: { ownerId: userId, publicId: key, storageProvider: 'R2' },
    });
    if (media && (media.ownerId !== userId || media.publicId !== key)) {
      return res.status(409).json({ error: 'Multipart upload is already registered to another media record' });
    }

    if (!media) {
      try {
        media = await prisma.media.create({
          data: {
            ownerId: userId,
            storageProvider: 'R2',
            cloudinaryAssetId: `r2:${key}`,
            publicId: key,
            multipartUploadId: uploadId,
            secureUrl: null,
            originalFilename: fileName.trim(),
            mimeType,
            mediaType,
            bytes: fileSize,
            status: 'PENDING',
          },
        });
      } catch (error) {
        // Concurrent completion requests may both pass the initial lookup.
        // The unique upload ID makes the winning database insert reusable.
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') throw error;
        media = await prisma.media.findFirst({ where: { multipartUploadId: uploadId } });
        if (!media || media.ownerId !== userId || media.publicId !== key) throw error;
      }
    } else if (!media.multipartUploadId) {
      media = await prisma.media.update({
        where: { id: media.id },
        data: { multipartUploadId: uploadId },
      });
    }

    if (media.status === 'FAILED') {
      media = await prisma.media.update({ where: { id: media.id }, data: { status: 'PENDING' } });
    }

    // the R2 object has been completed and verified, and its
    // media record has been persisted successfully.
    const sessionUpdate = await prisma.multipartUploadSession.updateMany({
      where: {
        id: result.session.id,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    if (sessionUpdate.count !== 1) {
      const latestSession = await prisma.multipartUploadSession.findUnique({
        where: { uploadId },
        select: { status: true },
      });
      if (latestSession?.status !== 'COMPLETED') {
        console.error('Media exists but the multipart session state changed', { uploadId });
        return res.status(409).json({ error: 'Multipart session state changed; retry completion to recover' });
      }
    }

    await enqueueMediaMetadata(media);

    try {
      const keys = await redis.keys(`cache:media:user:${userId}:*`);
      if (keys.length) await redis.del(...keys);
    } catch (cacheError) {
      console.error('Failed to clear cache:', cacheError);
    }

    res.status(201).json({
      success: true,
      data: { ...media, deliveryUrl: await getR2ObjectUrl(key) },
    });
  } catch (error) {
    console.error('Failed to complete multipart upload:', error);
    res.status(500).json({ error: 'Failed to assemble multipart upload' });
  }
});

// POST /api/upload/r2/multipart/abort
router.post('/r2/multipart/abort', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { key, uploadId } = req.body;

    if (
      typeof key !== 'string' ||
      typeof uploadId !== 'string' ||
      !key.startsWith(`vault/users/${userId}/`) ||
      !uploadId.trim()
    ) {
      return res.status(400).json({
        error: 'Invalid multipart abort parameters',
      });
    }

    // Look up the session and verify ownership.
    // Unlike requireActiveMultipartSession(), this deliberately
    // allows an expired ACTIVE session to be aborted.
    const session = await prisma.multipartUploadSession.findUnique({
      where: { uploadId },
      select: {
        id: true,
        userId: true,
        key: true,
        status: true,
      },
    });

    if (
      !session ||
      session.userId !== userId ||
      session.key !== key
    ) {
      return res.status(404).json({
        error: 'Multipart session not found',
      });
    }

    if (session.status !== 'ACTIVE') {
      return res.status(409).json({
        error: 'Multipart session is no longer active',
      });
    }

    // Abort the R2 upload first. If R2 fails, leave the database
    // session ACTIVE so the client can retry the cleanup.
    try {
      await getR2Client().send(
        new AbortMultipartUploadCommand({
          Bucket: getR2BucketName(),
          Key: key,
          UploadId: uploadId,
        }),
      );
    } catch (r2Error: any) {
      if (r2Error.name !== 'NoSuchUpload' && r2Error.$metadata?.httpStatusCode !== 404) {
        throw r2Error;
      }
    }

    // Conditional update protects against overwriting a status
    // change made by another request.
    const updated = await prisma.multipartUploadSession.updateMany({
      where: {
        id: session.id,
        status: 'ACTIVE',
      },
      data: {
        status: 'ABORTED',
        abortedAt: new Date(),
      },
    });

    if (updated.count !== 1) {
      return res.status(409).json({
        error: 'Multipart session state changed; please check its status',
      });
    }

    return res.json({
      success: true,
      data: { uploadId, status: 'ABORTED' },
    });
  } catch (error) {
    console.error('Failed to abort multipart upload:', error);
    return res.status(500).json({
      error: 'Failed to abort multipart upload',
    });
  }
},
);

export default router;
