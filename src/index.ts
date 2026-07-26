import { Client, Events, GatewayIntentBits } from "discord.js";
import { commandDefinitions, handleCommand } from "./commands.js";
import { config } from "./config.js";
import { startHealthServer } from "./health.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const healthServer = startHealthServer(client, config.healthPort);

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  try {
    if (config.guildId) {
      await readyClient.application.commands.set(
        commandDefinitions,
        config.guildId,
      );
    } else {
      await readyClient.application.commands.set(commandDefinitions);
    }

    console.log(
      config.guildId
        ? `Registered commands in guild ${config.guildId}`
        : "Registered global commands",
    );
  } catch (error) {
    console.error("Failed to register application commands", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    await handleCommand(interaction);
  } catch (error) {
    console.error(`Failed to handle /${interaction.commandName}`, error);

    const response = {
      content: "Something went wrong while running that command.",
      ephemeral: true,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(response);
    } else {
      await interaction.reply(response);
    }
  }
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received; shutting down`);
  healthServer.close();
  client.destroy();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

client.login(config.token).catch((error: unknown) => {
  console.error("Discord login failed", error);
  process.exitCode = 1;
  healthServer.close();
});
