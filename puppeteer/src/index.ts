import { redisClient } from "./lib/redis";
import { newSession, runGriffithAuthFlow } from "./campusgroups/auth";
import puppeteer, { BrowserContextOptions } from "puppeteer";
import { updateMemberList } from "./campusgroups/members";

async function main() {
  const browser = await puppeteer.launch();
  await runGriffithAuthFlow(browser);

  async function updateClubMemberList(clubId: string) {
    const context = await browser.createBrowserContext();
    await context.setCookie(...(await browser.cookies()));

    const page = await context.newPage();
    await newSession(page);

    await page.close();
  }

  await Promise.all([
    updateClubMemberList("24236"),
    updateClubMemberList("24237"),
  ]);

  await browser.close();

  console.log("done");
}

redisClient
  .connect()
  .catch((err) => {
    console.error("Failed to connect to Redis:", err);
  })
  .then(() => {
    console.log("Connected to Redis");
    main();
  });
