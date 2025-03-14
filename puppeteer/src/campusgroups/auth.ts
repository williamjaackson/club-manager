import { redisClient } from "../lib/redis";
import puppeteer, { Cookie, Page } from "puppeteer";
import { TOTP } from "totp-generator";
import config from "../../config.json";

async function waitForPage(page: Page, expectedUrl: string, navigationCount: number = 1) {
    for (let i = 0; i < navigationCount; i++) {
        await page.waitForNavigation().catch((e) => {
            console.log(`Failed to navigate to ${expectedUrl}, ${i} of ${navigationCount}, ${page.url()}, ${e}`);
        });
    }
    if (page.url() !== expectedUrl) {
        throw new Error(`Failed to navigate to ${expectedUrl}`);
    }
}

// get a new copy of authentication cookies.
async function newAuthCookies(
    student_id: string,
    password: string,
    otp_id: string,
    otp_secret: string,
): Promise<Cookie[]> {
    const browser = await puppeteer.launch();
    const page    = await browser.newPage();

    // Navigate to Campus Groups login page
    await page.goto('https://www.campusgroups.com/shibboleth/login?idp=griffith&school=griffith')
    await page.waitForSelector('#username');
    await page.type('#username', student_id);
    await page.type('#password', password);
    await page.keyboard.press('Enter');

    await waitForPage(page, 'https://authenticator.pingone.com.au/pingid/ppm/auth', 3);
    
    // move to the devices page.
    await page.goto('https://authenticator.pingone.com.au/pingid/ppm/devices');
    await page.waitForSelector(`[data-id="${otp_id}"]`);
    await page.click(`[data-id="${otp_id}"]`);
    await page.click('#device-submit')
    
    await waitForPage(page, 'https://authenticator.pingone.com.au/pingid/ppm/auth', 2);
    await page.waitForSelector('#otp');

    // // Enter PingID OTP
    const { otp } = TOTP.generate(otp_secret, { digits: 6 });
    
    await page.type('#otp', otp);
    await page.click('input[type="submit"]')
    
    await waitForPage(page, 'https://griffith.campusgroups.com/groups', 4);
    
    // Get cookies
    const browser_cookies = await browser.cookies();
    await browser.close();

    return browser_cookies.filter(cookie => cookie.domain == 'griffith.campusgroups.com')
} 

async function updateAuthCookies(): Promise<Cookie[]> {
    // set the cache to alive.
    // if another process requests the cache while this one is updating, it will return the OLD cached cookies.
    // once this process is finished, it will finish updating the cache.
    await redisClient.setEx('cache:auth-cookies:alive', config.cookieExpiry, '1');

    const cookies = await newAuthCookies(
        process.env.STUDENT_ID!,
        process.env.PASSWORD!,
        process.env.OTP_ID!,
        process.env.OTP_SECRET!,
    );

    await redisClient.set('cache:auth-cookies', JSON.stringify(cookies));
    return cookies;
}

// get a cached/new copy of authentication cookies.
export async function getAuthCookies(): Promise<Cookie[] | null> {
    let [cached_cookies, alive] = await redisClient.multi()
        .get('cache:auth-cookies')
        .get('cache:auth-cookies:alive')
        .exec();

    // if no cache exists, update and return the updated cookies.
    if (!cached_cookies) {
        return await updateAuthCookies();
    }

    // if the cache is expired, update in the background and return the cached cookies.
    if (!alive) {
        updateAuthCookies();
    }

    return JSON.parse(cached_cookies.toString());
}

export async function setAuthCookies(page: Page) {
    const cookies = await getAuthCookies();
    if (cookies) {
        await page.browser().setCookie(...cookies);
    }

    return page;
}