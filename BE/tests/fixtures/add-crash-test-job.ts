import { mediaQueue } from '../../src/queues/mediaQueue.js';
import { prisma } from '../../src/lib/prisma.js';

const media = await prisma.media.create({
  data: {
    ownerId: 'cmumokwyd00000scd4a7j9ekb',
    publicId: 'crash-test-image.jpg',
    originalFilename: 'crash-test-image.mp4',
    mimeType: 'video/mp4',
    mediaType: 'VIDEO',
    bytes: 1000,
    status: 'PENDING',
  },
});

const job = await mediaQueue.add(
  'PROCESS_METADATA',
  {
    mediaId: media.id,
    ownerId: media.ownerId,
    publicId: media.publicId!,
  },
  {
    jobId: `crash-test-${media.id}`,
    attempts: 3,
  },
);

console.log({
  mediaId: media.id,
  jobId: job.id,
});

await mediaQueue.close();
await prisma.$disconnect();