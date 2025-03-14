import { redisClient } from "./lib/redis";
import { setAuthCookies } from "./campusgroups/auth";
import puppeteer from "puppeteer";

async function main() {
    const browser = await puppeteer.launch();

    let page = await browser.newPage();
    page = await setAuthCookies(page);

    console.log(await browser.cookies());
}

redisClient.connect().catch(err => {
    console.error('Failed to connect to Redis:', err);
}).then(() => {
    console.log('Connected to Redis');
    main();
});