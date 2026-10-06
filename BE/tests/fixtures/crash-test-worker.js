import { Worker } from 'bullmq';
import { redis } from '../../src/config/redis.js';

const worker = new Worker(
  'media-processing-queue',
  async () => {
    console.log('TEST_WORKER_STARTED');

    // Stay inside the job until this process is killed.
    await new Promise(() => {});
  },
  {
    connection: redis,
  },
);

worker.on('error', (error) => {
  console.error(error);
});