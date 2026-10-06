import { Queue } from 'bullmq';
import { redis } from '../config/redis.js';

export const MEDIA_QUEUE_NAME = 'media-processing-queue';
export const MEDIA_METADATA_JOB = 'PROCESS_METADATA';
const MEDIA_METADATA_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: true,
  removeOnFail: 100,
};

export const mediaQueue = new Queue(MEDIA_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    ...MEDIA_METADATA_JOB_OPTIONS,
  },
});

export async function enqueueMediaMetadata(media: {
  id: string;
  ownerId: string;
  publicId: string | null;
  status: string;
}): Promise<void> {
  if (!media.publicId || media.status === 'READY') return;

  const jobId = `media-metadata-${media.id}`;
  const existing = await mediaQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'failed') await existing.remove();
    else return;
  }

  await mediaQueue.add(MEDIA_METADATA_JOB, {
    mediaId: media.id,
    ownerId: media.ownerId,
    publicId: media.publicId,
  }, { ...MEDIA_METADATA_JOB_OPTIONS, jobId });
}
