import { Queue } from 'bullmq';
import { redis } from '../config/redis.js';

export const MEDIA_QUEUE_NAME = 'media-processing-queue';

export const mediaQueue = new Queue(MEDIA_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000, // Retry after 1s, 2s, 4s on failures
    },
    removeOnComplete: true, // Keep Redis memory clean
    removeOnFail: 100, // Retain last 100 failed jobs for debugging
  },
});