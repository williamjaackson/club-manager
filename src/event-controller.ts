import { randomBytes } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type Attachment,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { AuditLogger } from "./audit.js";
import {
  EventUnavailableError,
  type EventRecord,
  type NewEventDraft,
  type Store,
} from "./database.js";
import {
  buildCancellationComplete,
  buildCreateEventModal,
  buildCurrentRsvp,
  buildEventPreview,
  buildPublicEventMessage,
  buildRsvpComplete,
  buildRsvpPrompt,
  eventIds,
} from "./event-ui.js";

interface PendingCreate {
  userId: string;
  guildId: string;
  artworkUrl?: string;
  artworkName?: string;
}

export class EventController {
  readonly #store: Store;
  readonly #audit: AuditLogger;
  readonly #pendingCreates = new Map<string, PendingCreate>();

  constructor(store: Store, audit: AuditLogger) {
    this.#store = store;
    this.#audit = audit;
  }

  async handleCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<boolean> {
    if (interaction.commandName === "ping") {
      await interaction.reply({
        content: `Pong! ${interaction.client.ws.ping}ms`,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (
      interaction.commandName !== "event" ||
      interaction.options.getSubcommand() !== "create"
    ) {
      return false;
    }

    this.#requireAdministrator(interaction);

    if (!interaction.guildId) {
      throw new Error("Events can only be created inside a server.");
    }

    const artwork = interaction.options.getAttachment("artwork");
    this.#validateArtwork(artwork);

    const token = randomBytes(16).toString("hex");
    const pending: PendingCreate = {
      userId: interaction.user.id,
      guildId: interaction.guildId,
    };

    if (artwork) {
      pending.artworkUrl = artwork.url;
      pending.artworkName = safeAttachmentName(artwork.name);
    }

    this.#pendingCreates.set(token, pending);
    const cleanup = setTimeout(
      () => this.#pendingCreates.delete(token),
      15 * 60_000,
    );
    cleanup.unref();

    await interaction.showModal(buildCreateEventModal(token));
    return true;
  }

  async handleModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith("event:create:")) return false;

    this.#requireAdministrator(interaction);

    const token = interaction.customId.slice("event:create:".length);
    const pending = this.#pendingCreates.get(token);

    if (
      !pending ||
      pending.userId !== interaction.user.id ||
      pending.guildId !== interaction.guildId
    ) {
      await interaction.reply({
        content: "This event form expired. Run `/event create` again.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    // A preview with artwork can take longer than Discord's three-second
    // interaction deadline while discord.js downloads and uploads the file.
    // Acknowledge the submission before doing any preview work.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    this.#pendingCreates.delete(token);

    if (!interaction.guildId) {
      throw new Error("Events can only be created inside a server.");
    }

    const channels = interaction.fields.getSelectedChannels(
      eventIds.channel,
      true,
      [ChannelType.GuildText, ChannelType.GuildAnnouncement],
    );
    const channel = channels.first();

    if (!channel?.isSendable()) {
      throw new Error("Select a text channel where the bot can send messages.");
    }

    const draft: NewEventDraft = {
      guildId: interaction.guildId,
      announcementChannelId: channel.id,
      creatorId: interaction.user.id,
      title: interaction.fields.getTextInputValue(eventIds.title).trim(),
      scheduleText: interaction.fields
        .getTextInputValue(eventIds.schedule)
        .trim(),
      location: interaction.fields
        .getTextInputValue(eventIds.location)
        .trim(),
      announcement: interaction.fields
        .getTextInputValue(eventIds.announcement)
        .trim(),
    };

    if (pending.artworkUrl) draft.artworkUrl = pending.artworkUrl;
    if (pending.artworkName) draft.artworkName = pending.artworkName;

    const event = this.#store.createEventDraft(draft);

    await interaction.editReply(buildEventPreview(event));
    return true;
  }

  async handleButton(interaction: ButtonInteraction): Promise<boolean> {
    const parsed = parseEventButton(interaction.customId);
    if (!parsed) return false;

    const event = this.#store.getEvent(parsed.eventId);

    if (!event) {
      await interaction.reply({
        content: "That event no longer exists.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (interaction.guildId !== event.guild_id) {
      throw new Error("That event belongs to a different server.");
    }

    switch (parsed.action) {
      case "publish":
        await this.#publish(interaction, event);
        return true;
      case "discard":
        await this.#discard(interaction, event);
        return true;
      case "rsvp":
        await this.#showRsvp(interaction, event);
        return true;
      case "rsvp-confirm":
        await this.#confirmRsvp(interaction, event);
        return true;
      case "cancel-confirm":
        await this.#cancelRsvp(interaction, event);
        return true;
      case "dismiss":
        await interaction.update({
          content: "No RSVP was recorded.",
          embeds: [],
          components: [],
        });
        return true;
    }
  }

  async #publish(
    interaction: ButtonInteraction,
    event: EventRecord,
  ): Promise<void> {
    this.#requireAdministrator(interaction);

    if (!this.#store.claimEventForPublishing(event.id)) {
      await interaction.update({
        content: "This draft has already been published or discarded.",
        embeds: [],
        components: [],
      });
      return;
    }

    await interaction.deferUpdate();
    let message;

    try {
      const channel = await interaction.client.channels.fetch(
        event.announcement_channel_id,
      );

      if (!channel?.isSendable()) {
        throw new Error("The announcement channel is unavailable.");
      }

      message = await channel.send(buildPublicEventMessage(event));
      this.#store.finishPublishing(event.id, message.id);
    } catch (error) {
      this.#store.releaseEventForPublishing(event.id);

      if (message) {
        await message.delete().catch(() => undefined);
      }

      throw error;
    }

    const url =
      `https://discord.com/channels/${event.guild_id}/` +
      `${event.announcement_channel_id}/${message.id}`;
    await interaction.editReply({
      content: `✅ Published **${event.title}** in <#${event.announcement_channel_id}>.`,
      embeds: [],
      attachments: [],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel("View announcement")
            .setURL(url)
            .setStyle(ButtonStyle.Link),
        ),
      ],
    });
  }

  async #discard(
    interaction: ButtonInteraction,
    event: EventRecord,
  ): Promise<void> {
    this.#requireAdministrator(interaction);
    const discarded = this.#store.discardEventDraft(event.id);

    await interaction.update({
      content: discarded
        ? `Discarded the draft for **${event.title}**.`
        : "This draft has already been published or discarded.",
      embeds: [],
      attachments: [],
      components: [],
    });
  }

  async #showRsvp(
    interaction: ButtonInteraction,
    event: EventRecord,
  ): Promise<void> {
    this.#requirePublished(event);

    if (interaction.message.id !== event.message_id) {
      throw new Error("Use the RSVP button on the original announcement.");
    }

    const status = this.#store.getRsvpStatus(event.id, interaction.user.id);

    await interaction.reply({
      ...(status === "active"
        ? buildCurrentRsvp(event)
        : buildRsvpPrompt(event)),
      flags: MessageFlags.Ephemeral,
    });
  }

  async #confirmRsvp(
    interaction: ButtonInteraction,
    event: EventRecord,
  ): Promise<void> {
    await interaction.deferUpdate();
    const result = this.#store.confirmRsvp(event.id, interaction.user.id);
    await interaction.editReply(buildRsvpComplete(event, result.changed));
    void this.#audit.flush();
  }

  async #cancelRsvp(
    interaction: ButtonInteraction,
    event: EventRecord,
  ): Promise<void> {
    await interaction.deferUpdate();
    const result = this.#store.cancelRsvp(event.id, interaction.user.id);
    await interaction.editReply(
      buildCancellationComplete(event, result.changed),
    );
    void this.#audit.flush();
  }

  #requireAdministrator(
    interaction:
      | ChatInputCommandInteraction
      | ModalSubmitInteraction
      | ButtonInteraction,
  ): void {
    if (
      !interaction.inGuild() ||
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    ) {
      throw new Error("Only server administrators can manage events.");
    }
  }

  #requirePublished(event: EventRecord): void {
    if (event.status !== "published" || !event.message_id) {
      throw new EventUnavailableError();
    }
  }

  #validateArtwork(artwork: Attachment | null): void {
    if (artwork && !artwork.contentType?.startsWith("image/")) {
      throw new Error("Event artwork must be an image.");
    }
  }
}

type EventButtonAction =
  | "publish"
  | "discard"
  | "rsvp"
  | "rsvp-confirm"
  | "cancel-confirm"
  | "dismiss";

function parseEventButton(
  customId: string,
): { action: EventButtonAction; eventId: number } | undefined {
  const match = /^event:([a-z-]+):(\d+)$/.exec(customId);
  if (!match) return undefined;

  const action = match[1] as EventButtonAction;
  const eventId = Number(match[2]);
  const actions: EventButtonAction[] = [
    "publish",
    "discard",
    "rsvp",
    "rsvp-confirm",
    "cancel-confirm",
    "dismiss",
  ];

  return actions.includes(action) ? { action, eventId } : undefined;
}

function safeAttachmentName(name: string): string {
  const sanitized = name
    .replaceAll(/[^a-zA-Z0-9._-]/g, "-")
    .replaceAll(/-+/g, "-")
    .slice(-100);
  return sanitized || "event-artwork.png";
}
