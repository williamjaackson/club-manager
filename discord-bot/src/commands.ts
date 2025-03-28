import path from "path";
import fs from "fs";
import { Client, Collection, Events, REST, Routes } from "discord.js";
import config from "../config.json";

declare module "discord.js" {
  interface Client {
    commands: Collection<string, any>;
  }
}

export function deployCommands(client: Client) {
  client.commands = new Collection();

  const commandDir = path.join(__dirname, "commands");

  if (fs.existsSync(commandDir)) {
    for (const file of fs.readdirSync(commandDir)) {
      const filePath = path.join(commandDir, file);

      // import command
      const command = require(filePath);
      client.commands.set(command.data.name, command);
    }
  }

  // command handler
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      console.error(
        `No command matching ${interaction.commandName} was found.`
      );
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);
    }
  });

  // deploy commands
  const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

  (async () => {
    try {
      console.log(
        `Started refreshing ${client.commands.size} application (/) commands.`
      );

      // The put method is used to fully refresh all commands in the guild with the current set
      const data: any = await rest.put(
        Routes.applicationGuildCommands(
          process.env.DISCORD_CLIENT_ID!,
          config.guildId
        ),
        { body: client.commands.map((command) => command.data.toJSON()) }
      );

      console.log(
        `Successfully reloaded ${data.length} application (/) commands.`
      );
    } catch (error) {
      console.error(error);
    }
  })();
}
