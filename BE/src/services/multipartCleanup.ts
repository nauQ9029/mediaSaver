import { AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { prisma } from '../lib/prisma.js';
import { getR2BucketName, getR2Client } from '../config/r2.js';

const BATCH_SIZE = 100;

export async function cleanupExpiredMultipartUploads() {
  const sessions = await prisma.multipartUploadSession.findMany({
    where: { status: 'ACTIVE', expiresAt: { lte: new Date() } },
    orderBy: { expiresAt: 'asc' },
    take: BATCH_SIZE,
    select: { id: true, key: true, uploadId: true },
  });

  for (const session of sessions) {
    try {
      try {
        await getR2Client().send(new AbortMultipartUploadCommand({
          Bucket: getR2BucketName(),
          Key: session.key,
          UploadId: session.uploadId,
        }));
      } catch (error) {
        const r2Error = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        // A missing R2 multipart upload is already cleaned up (for example,
        // if another worker or an explicit abort won the race).
        if (r2Error.name !== 'NoSuchUpload' && r2Error.$metadata?.httpStatusCode !== 404) {
          throw error;
        }
      }

      await prisma.multipartUploadSession.updateMany({
        where: { id: session.id, status: 'ACTIVE' },
        data: { status: 'ABORTED', abortedAt: new Date() },
      });
    } catch (error) {
      console.error('Failed to clean up expired multipart upload; will retry:', {
        uploadId: session.uploadId,
        error,
      });
    }
  }

  return sessions.length;
}

let cleanupTimer: ReturnType<typeof setInterval> | undefined;
let cleanupRunning = false;

export function startMultipartCleanupWorker() {
  if (cleanupTimer) return cleanupTimer;

  const run = async () => {
    if (cleanupRunning) return;

    cleanupRunning = true;
    try {
      await cleanupExpiredMultipartUploads();
    } catch (error) {
      console.error('Expired multipart upload cleanup failed:', error);
    } finally {
      cleanupRunning = false;
    }
  };

  void run();
  cleanupTimer = setInterval(() => void run(), 60 * 1000);
  cleanupTimer.unref();

  return cleanupTimer;
}
