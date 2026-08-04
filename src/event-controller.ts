import { randomBytes } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  WebhookType,
  type Attachment,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type NewsChannel,
  type TextChannel,
  type Webhook,
} from "discord.js";
import type { AuditLogger } from "./audit.js";
import { rsvpEligibility } from "./rsvp-eligibility.js";
import {
  EventUnavailableError,
  type EventRecord,
  type NewEventDraft,
  type NewPendingEventCreate,
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
  buildTicketCheckout,
  buildTicketConfirmed,
  eventIds,
} from "./event-ui.js";
import type { TicketingService } from "./ticketing.js";

export class EventController {
  readonly #store: Store;
  readonly #audit: AuditLogger;
  readonly #ticketing: TicketingService;
  readonly #webhookLookups = new Map<
    string,
    Promise<Webhook<WebhookType.Incoming>>
  >();

  constructor(
    store: Store,
    audit: AuditLogger,
    ticketing: TicketingService,
  ) {
    this.#store = store;
    this.#audit = audit;
    this.#ticketing = ticketing;
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
    const ticketPrice = interaction.options.getNumber("ticket_price");
    const ticketLimit = interaction.options.getInteger("ticket_limit");
    this.#validateArtwork(artwork);
    const ticketPriceCents = this.#ticketPriceCents(ticketPrice);

    if (ticketLimit !== null && ticketPriceCents === undefined) {
      throw new Error("Set ticket_price when using ticket_limit.");
    }

    const token = randomBytes(16).toString("hex");
    const pending: NewPendingEventCreate = {
      token,
      userId: interaction.user.id,
      guildId: interaction.guildId,
    };

    if (artwork) {
      pending.artworkUrl = artwork.url;
      pending.artworkName = safeAttachmentName(artwork.name);
    }
    if (ticketPriceCents !== undefined) {
      pending.ticketPriceCents = ticketPriceCents;
      pending.ticketCurrency = "aud";
    }
    if (ticketLimit !== null) pending.ticketLimit = ticketLimit;

    await Promise.all([
      this.#store.createPendingEventCreate(pending),
      interaction.showModal(buildCreateEventModal(token)),
    ]);
    return true;
  }

  async handleModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith("event:create:")) return false;

    this.#requireAdministrator(interaction);

    const token = interaction.customId.slice("event:create:".length);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const pending = await this.#store.consumePendingEventCreate(
      token,
      interaction.user.id,
      interaction.guildId,
    );

    if (!pending) {
      await interaction.editReply({
        content: "This event form expired. Run `/event create` again.",
      });
      return true;
    }

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

    if (pending.artwork_url) draft.artworkUrl = pending.artwork_url;
    if (pending.artwork_name) draft.artworkName = pending.artwork_name;
    if (pending.ticket_price_cents) {
      draft.ticketPriceCents = pending.ticket_price_cents;
    }
    if (pending.ticket_currency) {
      draft.ticketCurrency = pending.ticket_currency;
    }
    if (pending.ticket_limit) draft.ticketLimit = pending.ticket_limit;

    const event = await this.#store.createEventDraft(draft);

    await interaction.editReply(buildEventPreview(event));
    return true;
  }

  async handleButton(interaction: ButtonInteraction): Promise<boolean> {
    const parsed = parseEventButton(interaction.customId);
    if (!parsed) return false;

    if (parsed.action === "rsvp" || parsed.action === "buy") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
      await interaction.deferUpdate();
    }

    const event = await this.#store.getEvent(parsed.eventId);

    if (!event) {
      await interaction.editReply({
        content: "That event no longer exists.",
        components: [],
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
      case "buy":
        await this.#buyTicket(interaction, event);
        return true;
      case "rsvp-confirm":
        await this.#confirmRsvp(interaction, event);
        return true;
      case "cancel-confirm":
        await this.#cancelRsvp(interaction, event);
        return true;
      case "dismiss":
        await interaction.editReply({
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

    if (!(await this.#store.claimEventForPublishing(event.id))) {
      await interaction.editReply({
        content: "This draft has already been published or discarded.",
        embeds: [],
        components: [],
      });
      return;
    }

    let message;
    let webhook: Webhook<WebhookType.Incoming> | undefined;

    try {
      const channel = await interaction.client.channels.fetch(
        event.announcement_channel_id,
      );

      if (
        channel?.type !== ChannelType.GuildText &&
        channel?.type !== ChannelType.GuildAnnouncement
      ) {
        throw new Error("The announcement channel is unavailable.");
      }

      webhook = await this.#getOrCreateEventWebhook(
        channel,
        interaction.client.user.id,
      );
      const identity = commandRunnerIdentity(interaction);
      message = await webhook.send({
        ...buildPublicEventMessage(event),
        ...identity,
        withComponents: true,
      });
      await this.#store.finishPublishing(event.id, message.id);
    } catch (error) {
      await this.#store.releaseEventForPublishing(event.id);

      if (message && webhook) {
        await webhook.deleteMessage(message.id).catch(() => undefined);
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

  async #getOrCreateEventWebhook(
    channel: TextChannel | NewsChannel,
    botUserId: string,
  ): Promise<Webhook<WebhookType.Incoming>> {
    const existingLookup = this.#webhookLookups.get(channel.id);
    if (existingLookup) return existingLookup;

    const lookup = this.#findOrCreateEventWebhook(channel, botUserId);
    this.#webhookLookups.set(channel.id, lookup);

    try {
      return await lookup;
    } finally {
      if (this.#webhookLookups.get(channel.id) === lookup) {
        this.#webhookLookups.delete(channel.id);
      }
    }
  }

  async #findOrCreateEventWebhook(
    channel: TextChannel | NewsChannel,
    botUserId: string,
  ): Promise<Webhook<WebhookType.Incoming>> {
    const webhooks = await channel.fetchWebhooks();
    const existing = webhooks.find(
      (candidate) =>
        candidate.name === eventWebhookName &&
        candidate.owner?.id === botUserId &&
        candidate.isIncoming() &&
        Boolean(candidate.token),
    );

    if (existing?.isIncoming()) return existing;

    return channel.createWebhook({
      name: eventWebhookName,
      reason: "Publish event announcements as the command runner",
    });
  }

  async #discard(
    interaction: ButtonInteraction,
    event: EventRecord,
  ): Promise<void> {
    this.#requireAdministrator(interaction);
    const discarded = await this.#store.discardEventDraft(event.id);

    await interaction.editReply({
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

    if (!this.#canRsvp(interaction)) {
      await interaction.editReply(this.#verificationRequiredReply());
      return;
    }

    const status = await this.#store.getRsvpStatus(
      event.id,
      interaction.user.id,
    );

    await interaction.editReply(
      status === "active"
        ? buildCurrentRsvp(event)
        : buildRsvpPrompt(event),
    );
  }

  async #confirmRsvp(
    interaction: ButtonInteraction,
    event: EventRecord,
  ): Promise<void> {
    if (!this.#canRsvp(interaction)) {
      await interaction.editReply(this.#verificationRequiredReply());
      return;
    }

    const result = await this.#store.confirmRsvp(
      event.id,
      interaction.user.id,
    );
    await interaction.editReply(buildRsvpComplete(event, result.changed));
    void this.#audit.flush();
  }

  async #buyTicket(
    interaction: ButtonInteraction,
    event: EventRecord,
  ): Promise<void> {
    this.#requirePublished(event);

    if (interaction.message.id !== event.message_id) {
      throw new Error("Use the Buy ticket button on the original announcement.");
    }

    if (!this.#canRsvp(interaction)) {
      await interaction.editReply(this.#verificationRequiredReply());
      return;
    }

    if (!event.ticket_price_cents || !event.ticket_currency) {
      throw new Error("This event does not have paid tickets.");
    }

    const checkout = await this.#ticketing.startCheckout(
      event,
      interaction.user.id,
    );
    await interaction.editReply(
      checkout.alreadyPaid
        ? buildTicketConfirmed(event)
        : buildTicketCheckout(event, checkout.checkoutUrl),
    );
  }

  async #cancelRsvp(
    interaction: ButtonInteraction,
    event: EventRecord,
  ): Promise<void> {
    const result = await this.#store.cancelRsvp(
      event.id,
      interaction.user.id,
    );
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

  #canRsvp(interaction: ButtonInteraction): boolean {
    const roles = interaction.member?.roles;
    if (!roles) return false;

    const allowedRoleIds = [
      rsvpEligibility.connectedRoleId,
      rsvpEligibility.exemptRoleId,
    ];

    return Array.isArray(roles)
      ? allowedRoleIds.some((roleId) => roles.includes(roleId))
      : allowedRoleIds.some((roleId) => roles.cache.has(roleId));
  }

  #verificationRequiredReply(): { content: string; embeds: []; components: [] } {
    return {
      content:
        "Hey, please verify first, then try again: " +
        "https://discord.com/channels/1214387742293626940/1257896790934421535/1348722902375071785",
      embeds: [],
      components: [],
    };
  }

  #validateArtwork(artwork: Attachment | null): void {
    if (artwork && !artwork.contentType?.startsWith("image/")) {
      throw new Error("Event artwork must be an image.");
    }
  }

  #ticketPriceCents(price: number | null): number | undefined {
    if (price === null) return undefined;
    const cents = Math.round(price * 100);

    if (Math.abs(price * 100 - cents) > 1e-6) {
      throw new Error("ticket_price can have at most two decimal places.");
    }

    if (cents < 50) {
      throw new Error("ticket_price must be at least A$0.50.");
    }

    return cents;
  }
}

type EventButtonAction =
  | "publish"
  | "discard"
  | "buy"
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
    "buy",
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

const eventWebhookName = "Club Manager Event Announcements";

function commandRunnerIdentity(interaction: ButtonInteraction): {
  username: string;
  avatarURL: string;
} {
  const member = interaction.member;
  const cachedMember =
    member && "displayName" in member && "displayAvatarURL" in member
      ? member
      : undefined;

  return {
    username:
      cachedMember?.displayName ??
      (member && "nick" in member ? member.nick : undefined) ??
      interaction.user.globalName ??
      interaction.user.username,
    avatarURL:
      cachedMember?.displayAvatarURL({ extension: "png", size: 256 }) ??
      interaction.user.displayAvatarURL({ extension: "png", size: 256 }),
  };
}
