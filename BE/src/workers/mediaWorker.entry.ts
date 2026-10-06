import { mediaWorker } from './mediaWorker.js';

console.info('Media worker process started');

const shutdown = async (signal: string) => {
  console.info(`Received ${signal}, shutting down worker...`);

  await mediaWorker.close();

  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));