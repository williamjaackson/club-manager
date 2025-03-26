import { redisClient } from "../lib/redis";
import puppeteer, { Browser, Cookie, Page } from "puppeteer";
import { TOTP } from "totp-generator";
import config from "../../config.json";
import { waitForPage } from "./navigation";

// get a new copy of authentication cookies.
export async function runGriffithAuthFlow(
  browser: Browser,

  student_id: string = process.env.STUDENT_ID!,
  password: string = process.env.PASSWORD!,
  otp_id: string = process.env.OTP_ID!,
  otp_secret: string = process.env.OTP_SECRET!,
): Promise<Cookie[]> {
  const page = await browser.newPage();

  // Navigate to Campus Groups login page
  await page.goto(
    "https://www.campusgroups.com/shibboleth/login?idp=griffith&school=griffith",
  );
  await page.waitForSelector("#username");
  await page.type("#username", student_id);
  await page.type("#password", password);
  await page.keyboard.press("Enter");

  await waitForPage(page, `${config.URL.pingOne}/auth`, 3);

  // move to the devices page.
  await page.goto(`${config.URL.pingOne}/devices`);
  await page.waitForNetworkIdle();
  // await page.waitForSelector(`[data-id="${otp_id}"]`);
  await page.click(`[data-id="${otp_id}"]`);
  await page.click("#device-submit");

  await waitForPage(page, `${config.URL.pingOne}/auth`, 2);
  await page.waitForSelector("#otp");

  // Enter PingID OTP
  const { otp } = TOTP.generate(otp_secret, { digits: 6 });

  await page.type("#otp", otp);
  await page.click('input[type="submit"]');

  await waitForPage(page, `${config.URL.campusGroups}/groups`, 4, true);

  // Get cookies
  const browser_cookies = await browser.cookies();

  // remove all campusgroups.com cookies
  const filtered_cookies = browser_cookies.filter(
    (cookie) => !cookie.domain.includes("campusgroups.com"),
  );

  // clear all cookies from the browser
  await browser.deleteCookie(...browser_cookies);

  // set the filtered cookies
  await browser.setCookie(...filtered_cookies);

  return filtered_cookies;
}

export async function newSession(page: Page): Promise<void> {
  console.log("Running Griffith Auth Flow");
  await page.goto(
    "https://www.campusgroups.com/shibboleth/login?idp=griffith&school=griffith",
  );
  await waitForPage(page, `${config.URL.campusGroups}/groups`, 2, true);
  // const cookies = await runGriffithAuthFlow(page.browser());
  // await page.setCookie(...cookies);
}

// async function updateAuthCookies(): Promise<Cookie[]> {
//   // set the cache to alive.
//   // if another process requests the cache while this one is updating, it will return the OLD cached cookies.
//   // once this process is finished, it will finish updating the cache.
//   await redisClient.setEx("cache:auth-cookies:alive", config.cookieExpiry, "1");

//   const cookies = await runGriffithAuthFlow(
//     process.env.STUDENT_ID!,
//     process.env.PASSWORD!,
//     process.env.OTP_ID!,
//     process.env.OTP_SECRET!,
//   );

//   await redisClient.set("cache:auth-cookies", JSON.stringify(cookies));
//   return cookies;
// }

// // get a cached/new copy of authentication cookies.
// export async function getAuthCookies(): Promise<Cookie[] | null> {
//   let [cached_cookies, alive] = await redisClient
//     .multi()
//     .get("cache:auth-cookies")
//     .get("cache:auth-cookies:alive")
//     .exec();

//   // if no cache exists, update and return the updated cookies.
//   if (!cached_cookies) {
//     return await updateAuthCookies();
//   }

//   // if the cache is expired, update in the background and return the cached cookies.
//   if (!alive) {
//     updateAuthCookies();
//   }

//   return JSON.parse(cached_cookies.toString());
// }

// export async function setAuthCookies(page: Page): Promise<Cookie[] | null> {
//   const cookies = await getAuthCookies();
//   if (cookies) {
//     await page.browser().setCookie(...cookies);
//   }

//   return cookies;
// }
