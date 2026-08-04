import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type Interaction,
  type InteractionReplyOptions,
} from "discord.js";
import Stripe from "stripe";
import { AuditLogger } from "./audit.js";
import { commandDefinitions } from "./commands.js";
import { config } from "./config.js";
import {
  createDatabasePool,
  EventUnavailableError,
  initializeDatabase,
  Store,
} from "./database.js";
import { EventController } from "./event-controller.js";
import { startHttpServer } from "./health.js";
import { TicketingService } from "./ticketing.js";

await initializeDatabase(config.databaseUrl);
const databasePool = createDatabasePool(config.databaseUrl);
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});
const store = new Store(databasePool);
const audit = new AuditLogger(client, store, config.rsvpLogChannelId);
const stripe = new Stripe(config.stripeSecretKey);
const stripeTestMode =
  config.stripeTestSecretKey && config.stripeTestWebhookSecret
    ? {
        stripe: new Stripe(config.stripeTestSecretKey),
        webhookSecret: config.stripeTestWebhookSecret,
      }
    : undefined;
const ticketing = new TicketingService(
  stripe,
  store,
  config.publicBaseUrl,
  config.stripeWebhookSecret,
  stripeTestMode,
);
const eventController = new EventController(store, audit, ticketing);
const httpServer = startHttpServer(client, ticketing, config.healthPort);
let shuttingDown = false;

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

  try {
    const channel = await readyClient.channels.fetch(config.rsvpLogChannelId);

    if (!channel?.isSendable()) {
      throw new Error("channel is not sendable");
    }

    console.log(`RSVP audit channel ready: ${config.rsvpLogChannelId}`);
  } catch (error) {
    console.error(
      `RSVP audit channel ${config.rsvpLogChannelId} is unavailable`,
      error,
    );
  }

  audit.start();
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await eventController.handleCommand(interaction);
    } else if (interaction.isMessageContextMenuCommand()) {
      await eventController.handleContextMenu(interaction);
    } else if (interaction.isModalSubmit()) {
      await eventController.handleModal(interaction);
    } else if (interaction.isButton()) {
      await eventController.handleButton(interaction);
    }
  } catch (error) {
    console.error(`Failed to handle interaction ${interaction.id}`, error);
    await respondWithError(interaction, error);
  }
});

function errorMessage(error: unknown): string {
  if (error instanceof EventUnavailableError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong while processing that interaction.";
}

async function respondWithError(
  interaction: Interaction,
  error: unknown,
): Promise<void> {
  if (!interaction.isRepliable()) return;

  const response: InteractionReplyOptions = {
    content: errorMessage(error),
    flags: MessageFlags.Ephemeral,
  };

  try {
    if (interaction.deferred) {
      await interaction.editReply({
        content: errorMessage(error),
        components: [],
      });
    } else if (interaction.replied) {
      await interaction.followUp(response);
    } else {
      await interaction.reply(response);
    }
  } catch (responseError) {
    console.error("Failed to send interaction error response", responseError);
  }
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`${signal} received; shutting down`);
  audit.stop();
  httpServer.close();
  client.destroy();
  await store.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

client.login(config.token).catch(async (error: unknown) => {
  console.error("Discord login failed", error);
  process.exitCode = 1;
  await shutdown("Login failure");
});
