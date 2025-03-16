import { redisClient } from "./lib/redis";
import { setAuthCookies } from "./campusgroups/auth";
import puppeteer from "puppeteer";
import { updateMemberList } from "./campusgroups/members";

async function main() {
  const browser = await puppeteer.launch();

  let page = await browser.newPage();
  await setAuthCookies(page);
  await updateMemberList(page, "24237");

  await browser.close();
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
