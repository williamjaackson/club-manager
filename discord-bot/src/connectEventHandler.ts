import { Client, Events } from "discord.js";
import config from "../config.json";
import { processJoin, processLeave } from "./updateClubMember";
import { sql } from "./lib/database";

export async function connectEventHandler(client: Client) {
  client.on(Events.MessageCreate, async (message) => {
    if (message.channel.id != config.griffithConnect.logChannelId) return;
    if (message.author.id != config.griffithConnect.botUserId) return;

    // `${interaction.user} reconnected to ${sNumber}`,
    // `${prevConnectedMember.user} disconnected from ${existingConnection.student_number} by ${interaction.user}`,

    const isConnect = /\<\@(\d{17,19})\> (?:re)?connected to (s\d{7})/.exec(
      message.content
    );

    const isOverconnect =
      /\<\@(\d{17,19})\> disconnected from (s\d{7}) by \<\@(\d{17,19})\>/.exec(
        message.content
      );

    // HAVENT CHECKED IF THEY ARE A CLUB MEMBER.

    async function checkMembership(sNumber: string) {
      const [memberRecord] = await sql`
        SELECT * FROM campus_members
        JOIN campus_users ON campus_members.campus_user_id = campus_users.campus_user_id
        WHERE campus_users.student_number = ${sNumber}
      `;
      console.log("memberRecord", memberRecord, sNumber);

      return !!memberRecord;
    }

    if (isConnect) {
      const [memberId, sNumber] = [isConnect[1], isConnect[2]];
      console.log("memberId", memberId);
      console.log("sNumber", sNumber);
      const member = await message.guild!.members.fetch(memberId);

      if (!member) {
        console.log("Member not found, skipping");
        return;
      }

      if (!(await checkMembership(sNumber))) {
        console.log("Member is not a club member, processing join");
        return;
      }

      await processJoin(member);
    } else if (isOverconnect) {
      const [prevMemberId, sNumber, newMemberId] = isOverconnect?.slice(1, 3);

      const prevMember = await message.guild!.members.fetch(prevMemberId);
      if (!prevMember) {
        console.log("Previous member not found, skipping");
        return;
      }

      await processLeave(prevMember);
    }

    // const other = (!isConnect && !isReconnect && !isOverconnect) ? message.content : null;

    // ANY EXISTING CONNECTION:
    // same account new student number - CHECK IF MEMBER; REMOVE ROLE ?? GIVE ROLE (CONNECT)
    // new account same student number - REMOVE ROLE FROM OLD ACCOUNT, CHECK IF MEMBER; GIVE ROLE TO NEW ACCOUNT (OVERCONNECT)

    // REMOVE ROLE... CHECK IF MEMBER; GIVE ROLE TO NEW ACCOUNT?
  });
}
