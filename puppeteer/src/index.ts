import { redisClient } from "./lib/redis";
import { setAuthCookies } from "./campusgroups/auth";
import puppeteer from "puppeteer";
import { currentMemberList } from "./campusgroups/members";

async function main() {
  const browser = await puppeteer.launch();

  let page = await browser.newPage();
  await setAuthCookies(page);
  console.log(await currentMemberList(page, "24237"));

  // console.log(await page.browser().cookies());
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
