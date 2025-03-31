import {
  ButtonStyle,
  ActionRowBuilder,
  ButtonBuilder,
  Client,
  Events,
} from "discord.js";
import config from "../config.json";
import { processJoin, processLeave } from "./updateClubMember";
import { sql } from "./lib/database";
import { log } from "./lib/logging";

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

      return !!memberRecord;
    }

    if (isConnect) {
      const [memberId, sNumber] = [isConnect[1], isConnect[2]];
      const member = await message.guild!.members.fetch(memberId);

      if (!member) return;

      if (!(await checkMembership(sNumber))) {
        await processLeave(member);
        await member.send({
          content: `**You aren't a club member!**
Join __Griffith ICT Club__ on CampusGroups.

it's free and you get Club-Member access on Discord, access to events, and other perks!

-# LOG IN WITH YOUR GRIFFITH S-NUMBER TO BE AUTOMATICALLY CONNECTED`,
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setLabel("Gold Coast (In-Person Only)")
                .setURL("https://griffith.campusgroups.com/GIC/club_signup")
                .setStyle(ButtonStyle.Link),
              new ButtonBuilder()
                .setLabel("Brisbane/Online/Other")
                .setURL("https://griffith.campusgroups.com/GICT/club_signup")
                .setStyle(ButtonStyle.Link)
            ),
          ],
        });
        return;
      }

      await log(member.client, `<connect> Join: <@${member.id}>`);
      await processJoin(member);
    } else if (isOverconnect) {
      const [prevMemberId, sNumber, newMemberId] = isOverconnect?.slice(1, 3);

      const prevMember = await message.guild!.members.fetch(prevMemberId);
      if (!prevMember) {
        return;
      }

      await log(prevMember.client, `<over-connect> Leave: <@${prevMember.id}>`);
      await processLeave(prevMember);
    }

    // const other = (!isConnect && !isReconnect && !isOverconnect) ? message.content : null;

    // ANY EXISTING CONNECTION:
    // same account new student number - CHECK IF MEMBER; REMOVE ROLE ?? GIVE ROLE (CONNECT)
    // new account same student number - REMOVE ROLE FROM OLD ACCOUNT, CHECK IF MEMBER; GIVE ROLE TO NEW ACCOUNT (OVERCONNECT)

    // REMOVE ROLE... CHECK IF MEMBER; GIVE ROLE TO NEW ACCOUNT?
  });
}
