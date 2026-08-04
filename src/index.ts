import {
  Client,
  Events,
  GatewayIntentBits,
  type Interaction,
  type InteractionReplyOptions,
  MessageFlags,
} from "discord.js";
import Stripe from "stripe";
import { AnnouncementRefresher } from "./announcement-refresher.js";
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
import { startHttpServer } from "./http.js";
import { ReimbursementController } from "./reimbursement-controller.js";
import { GuildSettingsService } from "./settings.js";
import { TicketingService } from "./ticketing.js";

await initializeDatabase(config.databaseUrl);
const databasePool = createDatabasePool(config.databaseUrl);
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});
const store = new Store(databasePool);
const settings = new GuildSettingsService(store, {
  ...(config.rsvpLogChannelId ? { rsvpLogChannelId: config.rsvpLogChannelId } : {}),
  ...(config.verificationMessageUrl
    ? { verificationMessageUrl: config.verificationMessageUrl }
    : {}),
  ...(config.connectedRoleId ? { connectedRoleId: config.connectedRoleId } : {}),
  ...(config.exemptRoleId ? { exemptRoleId: config.exemptRoleId } : {}),
});
const audit = new AuditLogger(client, store, settings);
const refresher = new AnnouncementRefresher(client, store);
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
  (eventId) => refresher.markDirty(eventId),
);
const eventController = new EventController(store, audit, ticketing, settings, refresher);
const reimbursementController = new ReimbursementController(store, settings);
const httpServer = startHttpServer(client, ticketing, config.httpPort, () => {
  void audit.flush();
});
let shuttingDown = false;

// Last-resort safety net: a stray rejection or exception must never take the
// bot down mid-interaction. Root causes are still logged loudly.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection", reason);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception", error);
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  try {
    if (config.guildId) {
      await readyClient.application.commands.set(commandDefinitions, config.guildId);
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

  if (config.guildId) {
    try {
      const { rsvpLogChannelId } = await settings.resolve(config.guildId);
      if (!rsvpLogChannelId) {
        console.warn("No RSVP log channel configured; run /config in Discord.");
      } else {
        const channel = await readyClient.channels.fetch(rsvpLogChannelId);
        if (!channel?.isSendable()) {
          throw new Error("channel is not sendable");
        }
        console.log(`RSVP audit channel ready: ${rsvpLogChannelId}`);
      }
    } catch (error) {
      console.error("RSVP audit channel is unavailable", error);
    }
  }

  audit.start();
  refresher.start();
  ticketing.start();
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      (await eventController.handleCommand(interaction)) ||
        (await reimbursementController.handleCommand(interaction));
    } else if (interaction.isMessageContextMenuCommand()) {
      await eventController.handleContextMenu(interaction);
    } else if (interaction.isModalSubmit()) {
      (await eventController.handleModal(interaction)) ||
        (await reimbursementController.handleModal(interaction));
    } else if (interaction.isButton()) {
      (await eventController.handleButton(interaction)) ||
        (await reimbursementController.handleButton(interaction));
    } else if (interaction.isStringSelectMenu()) {
      (await eventController.handleSelect(interaction)) ||
        (await reimbursementController.handleSelect(interaction));
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

async function respondWithError(interaction: Interaction, error: unknown): Promise<void> {
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
  refresher.stop();
  ticketing.stop();
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
