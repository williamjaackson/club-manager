import { Page } from "puppeteer";
import { officerView } from "./club";
import config from "../../config.json";
import axios from "axios";
import { setAuthCookies } from "./auth";

export async function currentMemberList(
  page: Page,
  clubId: string,
): Promise<void> {
  let cookies = await page.browser().cookies();
  if (cookies.length === 0) {
    cookies = (await setAuthCookies(page)) ?? [];
  }
  // go to the club officer page
  await officerView(page, clubId);
  // go to the member tab
  await page.goto(`${config.URL.campusGroups}/members_list?status=members`);
  // download member list
  const cookieString = cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  const response = await axios.get(
    "https://griffith.campusgroups.com/mobile_ws/v17/mobile_manage_members?range=0&limit=&filter1=members&filter4_contains=undefined&filter4_notcontains=undefined&filter6_contains=OR&filter6_notcontains=OR&filter9_contains=undefined&filter9_notcontains=undefined&order=&search_word=&mode=&update=7&select_all=1&checkbox_ids=&actionParam=undefined",
    { headers: { Cookie: cookieString } },
  );
  // return member list
  return response.data;
}
