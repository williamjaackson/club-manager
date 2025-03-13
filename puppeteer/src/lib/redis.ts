import { createClient } from 'redis';

// Create a Redis client that connects to the Redis service defined in docker-compose
export const redisClient = createClient({
  url: 'redis://redis:6379'
});

// Set up basic error handling
redisClient.on('error', err => console.error('Redis Client Error:', err));

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await redisClient.disconnect();
  process.exit(0);
});