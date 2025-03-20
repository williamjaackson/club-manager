import { redisClient } from "./lib/redis";
import { newSession, runGriffithAuthFlow } from "./campusgroups/auth";
import puppeteer, { BrowserContextOptions } from "puppeteer";
import { updateMemberList } from "./campusgroups/members";

async function main() {
  const browser = await puppeteer.launch();
  // run Griffith Auth Flow
  await runGriffithAuthFlow(browser);

  // get new session
  const context1 = await browser.createBrowserContext();
  await context1.setCookie(...(await browser.cookies()));
  const page1 = await context1.newPage();
  await newSession(page1);

  const context2 = await browser.createBrowserContext();
  await context2.setCookie(...(await browser.cookies()));
  const page2 = await context2.newPage();
  await newSession(page2);

  // find the two session tokens
  const cookies1 = await context1.cookies();
  const cookies2 = await context2.cookies();

  const cookie1 = cookies1.find(
    (cookie) => cookie.name === "CG.SessionID",
  )?.value;
  const cookie2 = cookies2.find(
    (cookie) => cookie.name === "CG.SessionID",
  )?.value;

  console.log(cookie1, cookie2);

  // console.log(await browser.cookies());

  // get new CampusGroups session.

  // await getAuthCookies();

  // let page = await browser.newPage();

  // await setAuthCookies(page);
  // await updateMemberList(page, "24236");
  // await updateMemberList(page, "24237");

  // await page.close();

  // await browser.close();
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
