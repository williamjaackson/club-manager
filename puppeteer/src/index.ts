import puppeteer from "puppeteer";

async function main() {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('https://www.google.com');
    await page.screenshot({ path: 'screenshot.png' });
    await browser.close();
}

main();