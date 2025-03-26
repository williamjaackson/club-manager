import { Page } from "puppeteer";
import config from "../../config.json";

export async function waitForPage(
  page: Page,
  expectedUrl: string,
  navigationCount: number = 1,
) {
  for (let i = 0; i < navigationCount; i++) {
    if (page.url() === expectedUrl) {
      return;
    }
    await page.waitForNavigation().catch((e) => {
      console.log(
        `Failed to navigate to ${expectedUrl}, ${i} of ${navigationCount}, ${page.url()}, ${e}`,
      );
    });
  }
  if (page.url() !== expectedUrl) {
    throw new Error(`Failed to navigate to ${expectedUrl}`);
  }
}

export async function resetNavigation(page: Page): Promise<Page> {
  await page.goto(`${config.URL.campusGroups}/groups`);
  return page;
}
