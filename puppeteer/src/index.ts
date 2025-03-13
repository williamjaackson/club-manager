import { redisClient } from "./lib/redis";
import { getAuthCookies } from "./auth";

async function main() {
    const cookies = await getAuthCookies();
    console.log(cookies);
}

redisClient.connect().catch(err => {
    console.error('Failed to connect to Redis:', err);
}).then(() => {
    console.log('Connected to Redis');
    main();
});