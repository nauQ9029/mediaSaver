import { Redis } from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null, // Required for BullMQ compatibility in Phase 8.2
  enableReadyCheck: false,
});

redis.on('connect', () => {
  console.log('Connected to Redis instance');
});

redis.on('error', (err) => {
  console.error('Redis Client Error:', err);
});