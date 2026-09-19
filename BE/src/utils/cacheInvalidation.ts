import { redis } from '../config/redis.js';

/**
 * Invalidates all cached media feed keys for a specific user.
 */
export const invalidateUserMediaCache = async (userId: string): Promise<void> => {
  try {
    const pattern = `cache:media:user:${userId}:*`;
    const keys = await redis.keys(pattern);

    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    console.error(`Failed to invalidate cache for user ${userId}:`, error);
  }
};