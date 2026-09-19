import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis.js';
import { MEDIA_QUEUE_NAME } from '../queues/mediaQueue.js';

interface MediaProcessingJobData {
  mediaId: string;
  ownerId: string;
  publicId: string;
  action: 'PROCESS_METADATA' | 'GENERATE_THUMBNAIL';
}

export const mediaWorker = new Worker<MediaProcessingJobData>(
  MEDIA_QUEUE_NAME,
  async (job: Job<MediaProcessingJobData>) => {
    console.log(`⚙️ Processing background job ${job.id} for media ${job.data.mediaId}...`);

    switch (job.data.action) {
      case 'PROCESS_METADATA':
        // Heavy metadata extraction or external audit log
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Simulated work
        console.log(`✅ Completed metadata analysis for ${job.data.publicId}`);
        break;

      default:
        console.warn(`Unknown action type: ${job.data.action}`);
    }
  },
  { connection: redis }
);

mediaWorker.on('completed', (job) => {
  console.log(`🎉 Job ${job.id} finished successfully`);
});

mediaWorker.on('failed', (job, err) => {
  console.error(`❌ Job ${job?.id} failed with error: ${err.message}`);
});