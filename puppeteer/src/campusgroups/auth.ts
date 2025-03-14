import { redisClient } from "../lib/redis";
import puppeteer, { Cookie } from "puppeteer";
import { TOTP } from "totp-generator";
import config from "../../config.json";

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
    await page.type('#username', student_id);
    await page.type('#password', password);
    await page.keyboard.press('Enter');

    // wait for the page to navigate three times to get to the authenticator page, and verify it made it.
    await page.waitForNavigation();
    await page.waitForNavigation();
    await page.waitForNavigation();
    if (page.url() !== 'https://authenticator.pingone.com.au/pingid/ppm/auth')
        throw new Error('Failed to navigate to authenticator page.');
    
    // move to the devices page.
    await page.goto('https://authenticator.pingone.com.au/pingid/ppm/devices');
    await page.click(`[data-id="${otp_id}"]`);
    await page.click('#device-submit')
    
    await page.waitForNavigation();
    await page.waitForNavigation();
    if (page.url() !== 'https://authenticator.pingone.com.au/pingid/ppm/auth')
        throw new Error('Failed to navigate back to authenticator page.');

    // // Enter PingID OTP
    const { otp } = TOTP.generate(otp_secret, { digits: 6 });
    
    await page.type('#otp', otp);
    await page.click('input[type="submit"]')
    
    await page.waitForNavigation();
    await page.waitForNavigation();
    await page.waitForNavigation();
    await page.waitForNavigation();
    if (page.url() !== 'https://griffith.campusgroups.com/groups')
        throw new Error('Failed to navigate to Campus Groups page.');
    
    // Get cookies
    const browser_cookies = await browser.cookies();
    await browser.close();

    return browser_cookies.filter(cookie => cookie.domain == 'griffith.campusgroups.com')
} 

// get a cached/new copy of authentication cookies.
export async function getAuthCookies(): Promise<Cookie[] | null> {
    const cached_cookies = await redisClient.get('auth_cookies');
    if (cached_cookies) {
        return JSON.parse(cached_cookies);
    }

    const cookies = await newAuthCookies(
        process.env.STUDENT_ID!,
        process.env.PASSWORD!,
        process.env.OTP_ID!,
        process.env.OTP_SECRET!,
    ).catch((e) => {
        console.error(e);
        return null;
    });

    if (cookies) {
        await redisClient.setEx('auth_cookies', config.cookieExpiry, JSON.stringify(cookies));
    }

    return cookies;
}