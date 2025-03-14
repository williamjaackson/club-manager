import { Page } from "puppeteer";
import { resetNavigation } from "./navigation";
import config from "../../config.json";

export async function officerView(page: Page, clubId: string): Promise<Page> {
  await resetNavigation(page);
  await page.goto(
    `${config.URL.campusGroups}/officer_login_redirect?club_id=${clubId}`,
  );
  return page;
}

export async function memberView(page: Page, clubId: string): Promise<Page> {
  await resetNavigation(page);
  await page.goto(
    `${config.URL.campusGroups}/member_login_redirect?club_id=${clubId}`,
  );
  return page;
}
