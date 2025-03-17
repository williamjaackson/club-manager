import { Page } from "puppeteer";
import { officerView } from "./club";
import config from "../../config.json";
import axios from "axios";
import { setAuthCookies } from "./auth";
import { sql } from "../lib/database";
import { parse } from "csv-parse/sync";

export async function updateMemberList(
  page: Page,
  clubId: string,
): Promise<string[]> {
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

  // Parse CSV data
  const records = parse(response.data, {
    columns: true,
    skip_empty_lines: true,
  });

  // do I need to track new members? ON JOIN event from campus?.
  // YES. connect a member automatically to a club. should I send a new event for every club join, or just on the first club join?
  const newUsers = [];
  const existingMembers = await sql`
    SELECT * FROM campus_members
    WHERE club_id = ${clubId}
  `;

  // Insert records into database
  for (const record of records) {
    // console.log(record);
    const studentNumber = /(s\d{7})\@griffithuni\.edu\.au/.exec(
      record["Email"],
    )?.[1];

    const existingMember = existingMembers.find(
      (member) => member.campus_member_id === record["Member Identifier"],
    );

    if (!existingMember) {
      newUsers.push(record["User Identifier"]);
    }

    await sql`
      INSERT INTO campus_users (
        campus_user_id,
        student_number,
        first_name,
        last_name,
        campus_email
      ) VALUES (
        ${record["User Identifier"]},
        ${studentNumber},
        ${record["First Name"]},
        ${record["Last Name"]},
        ${record["Email"]}
      )
      ON CONFLICT (campus_user_id) DO NOTHING
    `;

    await sql`
      INSERT INTO campus_members (
        campus_user_id,
        campus_member_id,
        club_id
      ) VALUES (
        ${record["User Identifier"]},
        ${record["Member Identifier"]},
        ${clubId}
      )
      ON CONFLICT (campus_member_id) DO NOTHING
    `;
  }

  return newUsers;
}
