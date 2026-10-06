import { Job, UnrecoverableError, Worker } from 'bullmq';
import { redis } from '../config/redis.js';
import { prisma } from '../lib/prisma.js';
import { MEDIA_METADATA_JOB, MEDIA_QUEUE_NAME } from '../queues/mediaQueue.js';
import { PermanentMediaMetadataError, processMediaMetadata } from '../services/mediaMetadata.js';

interface MediaProcessingJobData {
  mediaId: string;
  ownerId: string;
  publicId: string;
}

export async function processMediaJob(job: Job<MediaProcessingJobData>): Promise<void> {
  if (job.name !== MEDIA_METADATA_JOB) {
    throw new UnrecoverableError(`Unsupported media job: ${job.name}`);
  }

  const context = {
    jobId: job.id,
    jobName: job.name,
    attempt: job.attemptsMade + 1,
    mediaId: job.data.mediaId,
    ownerId: job.data.ownerId,
  };
  console.info('Media metadata job started', context);

  try {
    await processMediaMetadata(job.data.mediaId, job.data.ownerId, job.data.publicId);
  } catch (error) {
    const permanent = error instanceof PermanentMediaMetadataError;
    const finalAttempt = permanent || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (finalAttempt) {
      await prisma.media.updateMany({
        where: { id: job.data.mediaId, ownerId: job.data.ownerId, status: 'PENDING' },
        data: { status: 'FAILED' },
      });
    }

    console.error('Media metadata job attempt failed', {
      ...context,
      finalAttempt,
      error: error instanceof Error ? error.message : String(error),
    });

    if (permanent) throw new UnrecoverableError((error as Error).message);
    throw error;
  }
}

export const mediaWorker = new Worker<MediaProcessingJobData>(
  MEDIA_QUEUE_NAME,
  processMediaJob,
  { connection: redis, concurrency: 2 },
);

mediaWorker.on('completed', (job) => {
  console.info('Media metadata job completed', { jobId: job.id, mediaId: job.data.mediaId, ownerId: job.data.ownerId });
});

mediaWorker.on('failed', (job, error) => {
  console.error('Media metadata job attempt failed', {
    jobId: job?.id,
    jobName: job?.name,
    attemptsMade: job?.attemptsMade,
    mediaId: job?.data.mediaId,
    ownerId: job?.data.ownerId,
    error: error.message,
  });
});

mediaWorker.on('error', (error) => {
  console.error('Media worker runtime error', { error: error.message });
});
