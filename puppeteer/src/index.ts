import { redisClient } from "./lib/redis";
import { newSession, runGriffithAuthFlow } from "./campusgroups/auth";
import puppeteer from "puppeteer";
import { updateMemberList } from "./campusgroups/members";
import config from "../config.json";
async function updateMemberLists() {
  const browser = await puppeteer.launch();
  await runGriffithAuthFlow(browser);

  async function updateClubMemberList(clubId: string) {
    const context = await browser.createBrowserContext();
    await context.setCookie(...(await browser.cookies()));

    const page = await context.newPage();
    await newSession(page);

    await updateMemberList(page, clubId);

    await page.close();
  }

  await Promise.all([
    updateClubMemberList("24236"),
    updateClubMemberList("24237"),
  ]);

  await browser.close();
}

async function main() {
  let retryCount = 0;
  async function handler() {
    try {
      await updateMemberLists();
    } catch (err) {
      console.error("Failed to update member lists:", err);
      retryCount++;
      if (retryCount > 3) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * 5));
      await handler();
    }
  }

  await handler();
}
redisClient
  .connect()
  .catch((err) => {
    console.error("Failed to connect to Redis:", err);
  })
  .then(() => {
    console.log("Connected to Redis");
    main();
    setInterval(main, config.updateInterval * 1000);
  });
