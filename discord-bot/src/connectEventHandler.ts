import { Client, Events, GuildMember } from "discord.js";
import config from "../config.json";
import { processJoin, processLeave } from "./updateClubMember";

export async function connectEventHandler(client: Client) {
  client.on(Events.MessageCreate, async (message) => {
    if (message.channel.id != config.griffithConnect.logChannelId) return;
    if (message.author.id != config.griffithConnect.botUserId) return;

    // `${interaction.user} reconnected to ${sNumber}`,
    // `${prevConnectedMember.user} disconnected from ${existingConnection.student_number} by ${interaction.user}`,

    const isConnect = /(\<\@\d{17,19}\>) (?:re)?connected to (s\d{7})/.exec(
      message.content
    );

    const isOverconnect =
      /(\<\@\d{17,19}\>) disconnected from (s\d{7}) by (\<\@\d{17,19}\>)/.exec(
        message.content
      );

    // HAVENT CHECKED IF THEY ARE A CLUB MEMBER.

    async function checkMembership(sNumber: string) {
      return true;
    }

    if (isConnect) {
      const [memberId, sNumber] = isConnect.slice(1, 2);
      const member = await message.guild!.members.fetch(memberId);

      if (await checkMembership(sNumber)) {
        await processJoin(member);
      }
    } else if (isOverconnect) {
      const [prevMemberId, sNumber, newMemberId] = isOverconnect?.slice(1, 3);

      const prevMember = await message.guild!.members.fetch(prevMemberId);
      const newMember = await message.guild!.members.fetch(newMemberId);

      await processLeave(prevMember);
      if (await checkMembership(sNumber)) {
        await processJoin(newMember);
      }
    }

    // const other = (!isConnect && !isReconnect && !isOverconnect) ? message.content : null;

    // ANY EXISTING CONNECTION:
    // same account new student number - CHECK IF MEMBER; REMOVE ROLE ?? GIVE ROLE (CONNECT)
    // new account same student number - REMOVE ROLE FROM OLD ACCOUNT, CHECK IF MEMBER; GIVE ROLE TO NEW ACCOUNT (OVERCONNECT)

    // REMOVE ROLE... CHECK IF MEMBER; GIVE ROLE TO NEW ACCOUNT?
  });
}
