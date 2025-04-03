import { Page } from "puppeteer";
import { officerView } from "./club";
import config from "../../config.json";
import axios from "axios";
// import { setAuthCookies } from "./auth";
import { supabase } from "../lib/database";
import { parse } from "csv-parse/sync";
import { redisClient } from "../lib/redis";

export async function updateMemberList(
  page: Page,
  clubId: string,
): Promise<[string[], string[]]> {
  // go to the club officer page
  await officerView(page, clubId);

  // go to the member tab
  await page.goto(`${config.URL.campusGroups}/members_list?status=members`);

  let cookies = await page.browserContext().cookies();
  if (cookies.length === 0) {
    throw new Error("No cookies found");
    // cookies = (await setAuthCookies(page)) ?? [];
  }
  // download member list
  const cookieString = cookies
    .filter((cookie) => cookie.domain === "griffith.campusgroups.com")
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
  const newMembers = [];
  let { data: existingMembers } = await supabase
    .from("campus_members")
    .select("*")
    .eq("club_id", clubId);
  existingMembers = existingMembers ?? [];

  if (
    Math.abs(records.length - existingMembers.length) >
    existingMembers.length * 0.1
  ) {
    throw new Error(
      "Number of records is not within 10% of the existing members. Likely: failed to fetch the correct list.",
    );
  }

  // Insert records into database
  for (const record of records) {
    const existingMember = existingMembers.find(
      (member) => member.campus_member_id === record["Member Identifier"],
    );

    if (existingMember) {
      existingMembers.splice(existingMembers.indexOf(existingMember), 1);
      continue;
    } else {
      newMembers.push(record["Member Identifier"]);
    }

    const studentNumber = /(s\d{7})\@griffithuni\.edu\.au/.exec(
      record["Email"],
    )?.[1];

    await supabase.from("campus_users").insert({
      campus_user_id: record["User Identifier"],
      student_number: studentNumber,
      first_name: record["First Name"],
      last_name: record["Last Name"],
      campus_email: record["Email"],
    });

    await supabase.from("campus_members").insert({
      campus_user_id: record["User Identifier"],
      campus_member_id: record["Member Identifier"],
      club_id: clubId,
    });

    await redisClient.publish(
      "member:join",
      JSON.stringify({
        campus_user_id: record["User Identifier"],
        campus_member_id: record["Member Identifier"],
        club_id: clubId,
      }),
    );
  }

  for (const existingMember of existingMembers) {
    // all of these people have left the campus_groups since last time we updated the list
    // remove from database
    await supabase
      .from("campus_members")
      .delete()
      .eq("campus_member_id", existingMember.campus_member_id);

    await redisClient.publish(
      "member:leave",
      JSON.stringify({
        campus_user_id: existingMember.campus_user_id,
        campus_member_id: existingMember.campus_member_id,
        club_id: clubId,
      }),
    );
  }

  const oldMembers = existingMembers.map((member) => member.campus_member_id);

  return [newMembers, oldMembers];
}
