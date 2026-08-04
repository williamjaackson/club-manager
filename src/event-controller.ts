import { randomBytes } from "node:crypto";
import {
  ActionRowBuilder,
  type Attachment,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ChannelType,
  type ChatInputCommandInteraction,
  type MessageContextMenuCommandInteraction,
  MessageFlags,
  type ModalSubmitInteraction,
  type NewsChannel,
  PermissionFlagsBits,
  type TextChannel,
  type Webhook,
  type WebhookType,
} from "discord.js";
import type { AuditLogger } from "./audit.js";
import {
  EventAdmissionClosedError,
  EventFinishedError,
  type EventRecord,
  EventUnavailableError,
  type NewEventDraft,
  type NewPendingEventCreate,
  type PendingEventCreateRecord,
  type Store,
  TicketSalesClosedError,
} from "./database.js";
import {
  buildCancellationComplete,
  buildClosedAdmissionComponents,
  buildCreateEventAdmissionModal,
  buildCreateEventDetailsModal,
  buildCreateEventScheduleModal,
  buildCurrentRsvp,
  buildEventAnnouncementText,
  buildEventPreview,
  buildEventWizardContinue,
  buildPublicEventMessage,
  buildReminderMessage,
  buildRsvpComplete,
  buildRsvpPrompt,
  buildTicketCheckout,
  buildTicketConfirmed,
  eventIds,
} from "./event-ui.js";
import { rsvpEligibility } from "./rsvp-eligibility.js";
import type { TicketingService } from "./ticketing.js";
import {
  currentTimestamp,
  formatScheduleText,
  optionalBrisbaneDateTime,
  parseBrisbaneDateTime,
} from "./time.js";

export class EventController {
  readonly #store: Store;
  readonly #audit: AuditLogger;
  readonly #ticketing: TicketingService;
  readonly #webhookLookups = new Map<string, Promise<Webhook<WebhookType.Incoming>>>();

  constructor(store: Store, audit: AuditLogger, ticketing: TicketingService) {
    this.#store = store;
    this.#audit = audit;
    this.#ticketing = ticketing;
  }

  async handleCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (interaction.commandName === "ping") {
      await interaction.reply({
        content: `Pong! ${interaction.client.ws.ping}ms`,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (interaction.commandName === "reminder") {
      await this.#sendReminder(interaction);
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

    const token = randomBytes(16).toString("hex");
    const pending: NewPendingEventCreate = {
      token,
      userId: interaction.user.id,
      guildId: interaction.guildId,
    };

    // Discord allows 3 seconds to show the modal; don't let a slow Neon
    // round-trip consume that window.
    await Promise.all([
      this.#store.createPendingEventCreate(pending),
      interaction.showModal(buildCreateEventDetailsModal(token)),
    ]);
    return true;
  }

  async handleContextMenu(
    interaction: MessageContextMenuCommandInteraction,
  ): Promise<boolean> {
    if (interaction.commandName !== "Close Event") return false;

    this.#requireAdministrator(interaction);
    if (!interaction.guildId) {
      throw new Error("Events can only be closed inside a server.");
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const event = await this.#store.getEventByAdmissionMessageId(
      interaction.guildId,
      interaction.targetMessage.id,
    );
    if (event?.status !== "published" || !event.message_id) {
      throw new Error("Use Close Event on an event announcement or reminder.");
    }

    const changed = await this.#store.closeEventAdmission(event.id);
    const closedEvent = await this.#store.getEvent(event.id);
    if (!closedEvent) throw new Error("That event no longer exists.");

    const failedUpdates = await this.#refreshClosedAdmissionMessages(
      interaction,
      closedEvent,
    ).catch((error) => {
      console.error("Failed to refresh closed event messages", error);
      return 1;
    });
    await interaction.editReply({
      content:
        (changed
          ? `🔒 Closed **${event.title}**. No new RSVPs or ticket purchases will be accepted.`
          : `**${event.title}** was already closed.`) +
        (failedUpdates > 0
          ? " Some old buttons could not be disabled visually, but they will still refuse admission."
          : ""),
      components: [],
    });
    return true;
  }

  async #refreshClosedAdmissionMessages(
    interaction: MessageContextMenuCommandInteraction,
    event: EventRecord,
  ): Promise<number> {
    const channel = await interaction.client.channels.fetch(
      event.announcement_channel_id,
    );
    if (
      channel?.type !== ChannelType.GuildText &&
      channel?.type !== ChannelType.GuildAnnouncement
    ) {
      return 1;
    }

    const components = buildClosedAdmissionComponents(event);
    const updates: Promise<unknown>[] = [];
    if (event.message_id) {
      updates.push(
        this.#getOrCreateEventWebhook(channel, interaction.client.user.id).then(
          (webhook) =>
            webhook.editMessage(event.message_id!, {
              content: buildEventAnnouncementText(event),
              components,
            }),
        ),
      );
    }
    const reminderIds = await this.#store.getEventReminderMessageIds(event.id);
    for (const reminderId of reminderIds) {
      updates.push(
        channel.messages
          .fetch(reminderId)
          .then((message) => message.edit({ components })),
      );
    }

    const results = await Promise.allSettled(updates);
    let failureCount = 0;
    for (const result of results) {
      if (result.status !== "rejected") continue;
      failureCount += 1;
      console.error("Failed to disable a closed event button", result.reason);
    }
    return failureCount;
  }

  async handleModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    const parsed = parseEventWizardStep(interaction.customId);
    if (!parsed) return false;

    this.#requireAdministrator(interaction);
    if (!interaction.guildId) {
      throw new Error("Events can only be created inside a server.");
    }

    switch (parsed.step) {
      case "details":
        await this.#saveEventDetails(interaction, parsed.token);
        return true;
      case "schedule":
        await this.#saveEventSchedule(interaction, parsed.token);
        return true;
      case "admission":
        await this.#finishEventWizard(interaction, parsed.token);
        return true;
    }
  }

  async #saveEventDetails(
    interaction: ModalSubmitInteraction,
    token: string,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channels = interaction.fields.getSelectedChannels(eventIds.channel, true, [
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
    ]);
    const channel = channels.first();
    if (!channel?.isSendable()) {
      throw new Error("Select a text channel where the bot can send messages.");
    }

    const artwork = interaction.fields.getUploadedFiles(eventIds.artwork)?.first();
    this.#validateArtwork(artwork ?? null);
    const saved = await this.#store.updatePendingEventDetails(
      token,
      interaction.user.id,
      interaction.guildId,
      {
        announcementChannelId: channel.id,
        title: interaction.fields.getTextInputValue(eventIds.title).trim(),
        location: interaction.fields.getTextInputValue(eventIds.location).trim(),
        announcement: interaction.fields.getTextInputValue(eventIds.announcement).trim(),
        ...(artwork
          ? {
              artworkUrl: artwork.url,
              artworkName: safeAttachmentName(artwork.name),
            }
          : {}),
      },
    );
    if (!saved) {
      await this.#eventWizardExpired(interaction);
      return;
    }
    await interaction.editReply(buildEventWizardContinue(token, "schedule"));
  }

  async #saveEventSchedule(
    interaction: ModalSubmitInteraction,
    token: string,
  ): Promise<void> {
    const startsAt = parseBrisbaneDateTime(
      interaction.fields.getTextInputValue(eventIds.startsAt),
      "Start time",
    );
    const endsAt = optionalBrisbaneDateTime(
      interaction.fields.getTextInputValue(eventIds.endsAt),
      "Finish time",
    );
    const ticketSalesCloseAt = optionalBrisbaneDateTime(
      interaction.fields.getTextInputValue(eventIds.ticketSalesCloseAt),
      "Ticket sales close",
    );
    if (startsAt <= currentTimestamp()) {
      throw new Error("Start time must be in the future.");
    }
    if (endsAt !== undefined && endsAt <= startsAt) {
      throw new Error("Finish time must be after the start time.");
    }
    if (endsAt !== undefined && endsAt <= currentTimestamp()) {
      throw new Error("Finish time must be in the future.");
    }
    if (ticketSalesCloseAt !== undefined && ticketSalesCloseAt <= currentTimestamp()) {
      throw new Error("Ticket sales close must be in the future.");
    }
    if (
      endsAt !== undefined &&
      ticketSalesCloseAt !== undefined &&
      ticketSalesCloseAt >= endsAt
    ) {
      throw new Error("Ticket sales close must be earlier than the finish time.");
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const saved = await this.#store.updatePendingEventSchedule(
      token,
      interaction.user.id,
      interaction.guildId,
      {
        startsAt,
        ...(endsAt !== undefined ? { endsAt } : {}),
        ...(ticketSalesCloseAt !== undefined ? { ticketSalesCloseAt } : {}),
      },
    );
    if (!saved) {
      await this.#eventWizardExpired(interaction);
      return;
    }
    await interaction.editReply(buildEventWizardContinue(token, "admission"));
  }

  async #finishEventWizard(
    interaction: ModalSubmitInteraction,
    token: string,
  ): Promise<void> {
    const ticketPriceCents = this.#ticketPriceCents(
      interaction.fields.getTextInputValue(eventIds.ticketPrice),
    );
    const capacity = this.#capacity(
      interaction.fields.getTextInputValue(eventIds.capacity),
    );
    const testMode = interaction.fields.getCheckbox(eventIds.testMode);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const pending = await this.#pendingEventWizard(interaction, token);
    if (!pending) {
      await this.#eventWizardExpired(interaction);
      return;
    }
    if (
      !pending.announcement_channel_id ||
      !pending.title ||
      !pending.location ||
      !pending.announcement ||
      typeof pending.starts_at !== "number"
    ) {
      throw new Error("Complete the event details and schedule steps first.");
    }
    if (pending.ticket_sales_close_at !== null && ticketPriceCents === undefined) {
      throw new Error("Ticket sales close requires a paid ticket price.");
    }
    if (testMode && ticketPriceCents === undefined) {
      throw new Error("Stripe test events require a paid ticket price.");
    }

    const consumed = await this.#store.consumePendingEventCreate(
      token,
      interaction.user.id,
      interaction.guildId,
    );
    if (!consumed) {
      await this.#eventWizardExpired(interaction);
      return;
    }

    const draft: NewEventDraft = {
      guildId: interaction.guildId!,
      announcementChannelId: pending.announcement_channel_id,
      creatorId: interaction.user.id,
      title: pending.title,
      scheduleText: formatScheduleText(pending.starts_at, pending.ends_at ?? undefined),
      location: pending.location,
      announcement: pending.announcement,
      startsAt: pending.starts_at,
    };
    if (pending.ends_at !== null) draft.endsAt = pending.ends_at;
    if (pending.artwork_url) draft.artworkUrl = pending.artwork_url;
    if (pending.artwork_name) draft.artworkName = pending.artwork_name;
    if (ticketPriceCents !== undefined) {
      draft.ticketPriceCents = ticketPriceCents;
      draft.ticketCurrency = "aud";
    }
    if (capacity !== undefined) draft.ticketLimit = capacity;
    if (testMode) draft.testMode = true;
    if (pending.ticket_sales_close_at !== null) {
      draft.ticketSalesCloseAt = pending.ticket_sales_close_at;
    }

    const event = await this.#store.createEventDraft(draft);
    await interaction.editReply(buildEventPreview(event));
  }

  async #pendingEventWizard(
    interaction: ModalSubmitInteraction | ButtonInteraction,
    token: string,
  ): Promise<PendingEventCreateRecord | undefined> {
    const pending = await this.#store.getPendingEventCreate(token);
    return pending?.user_id === interaction.user.id &&
      pending.guild_id === interaction.guildId
      ? pending
      : undefined;
  }

  async #eventWizardExpired(
    interaction: ModalSubmitInteraction | ButtonInteraction,
  ): Promise<void> {
    await interaction.editReply({
      content: "This event form expired. Run `/event create` again.",
      components: [],
    });
  }

  async #sendReminder(interaction: ChatInputCommandInteraction): Promise<void> {
    this.#requireAdministrator(interaction);
    if (!interaction.guildId) {
      throw new Error("Reminders can only be sent inside a server.");
    }

    const link = parseAnnouncementLink(
      interaction.options.getString("announcement", true),
    );
    if (!link || link.guildId !== interaction.guildId) {
      throw new Error("Paste an event announcement link from this server.");
    }
    const reminderText = interaction.options.getString("message", true).trim();
    if (!reminderText) {
      throw new Error("Reminder message cannot be empty.");
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const event = await this.#store.getEventByMessageId(
      interaction.guildId,
      link.messageId,
    );
    if (
      event?.status !== "published" ||
      event.announcement_channel_id !== link.channelId
    ) {
      throw new Error("That link is not a published event announcement.");
    }

    const channel = await interaction.client.channels.fetch(link.channelId);
    if (
      channel?.type !== ChannelType.GuildText &&
      channel?.type !== ChannelType.GuildAnnouncement
    ) {
      throw new Error("The event announcement channel is unavailable.");
    }

    const announcement = await channel.messages.fetch(link.messageId);
    const reminder = await announcement.reply(buildReminderMessage(event, reminderText));

    try {
      await this.#store.recordEventReminder(event.id, reminder.id);
    } catch (error) {
      await reminder.delete().catch(() => undefined);
      throw error;
    }

    await interaction.editReply({
      content: `✅ Sent a reminder for **${event.title}**.`,
      components: [],
    });
  }

  async handleButton(interaction: ButtonInteraction): Promise<boolean> {
    const wizard = parseEventWizardStep(interaction.customId);
    if (wizard && wizard.step !== "details") {
      this.#requireAdministrator(interaction);
      const pending = await this.#pendingEventWizard(interaction, wizard.token);
      if (!pending) {
        await interaction.reply({
          content: "This event form expired. Run `/event create` again.",
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      await interaction.showModal(
        wizard.step === "schedule"
          ? buildCreateEventScheduleModal(wizard.token)
          : buildCreateEventAdmissionModal(wizard.token),
      );
      return true;
    }

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

  async #publish(interaction: ButtonInteraction, event: EventRecord): Promise<void> {
    this.#requireAdministrator(interaction);

    if (!(await this.#store.claimEventForPublishing(event.id))) {
      await interaction.editReply({
        content: "This draft has already been published or discarded.",
        embeds: [],
        components: [],
      });
      return;
    }

    let message: Awaited<ReturnType<Webhook<WebhookType.Incoming>["send"]>> | undefined;
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

      webhook = await this.#getOrCreateEventWebhook(channel, interaction.client.user.id);
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

  async #discard(interaction: ButtonInteraction, event: EventRecord): Promise<void> {
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

  async #showRsvp(interaction: ButtonInteraction, event: EventRecord): Promise<void> {
    this.#requirePublished(event);
    this.#requireFreeEvent(event);
    await this.#requireAdmissionMessage(interaction, event);
    await this.#recordInterest(event, interaction.user.id, "rsvp");
    this.#requireRsvpOpen(event);

    if (!this.#canRsvp(interaction)) {
      await interaction.editReply(this.#verificationRequiredReply());
      return;
    }

    const status = await this.#store.getRsvpStatus(event.id, interaction.user.id);

    await interaction.editReply(
      status === "active" ? buildCurrentRsvp(event) : buildRsvpPrompt(event),
    );
  }

  async #confirmRsvp(interaction: ButtonInteraction, event: EventRecord): Promise<void> {
    this.#requireFreeEvent(event);
    this.#requireRsvpOpen(event);

    if (!this.#canRsvp(interaction)) {
      await interaction.editReply(this.#verificationRequiredReply());
      return;
    }

    const result = await this.#store.confirmRsvp(event.id, interaction.user.id);
    await interaction.editReply(buildRsvpComplete(event, result.changed));
    void this.#audit.flush();
  }

  #requireFreeEvent(event: EventRecord): void {
    if (typeof event.ticket_price_cents === "number") {
      throw new Error("This is a paid event. Use the Buy ticket button instead.");
    }
  }

  async #buyTicket(interaction: ButtonInteraction, event: EventRecord): Promise<void> {
    this.#requirePublished(event);
    await this.#requireAdmissionMessage(interaction, event);
    await this.#recordInterest(event, interaction.user.id, "ticket");
    this.#requireTicketSalesOpen(event);

    if (!this.#canRsvp(interaction)) {
      await interaction.editReply(this.#verificationRequiredReply());
      return;
    }

    if (!event.ticket_price_cents || !event.ticket_currency) {
      throw new Error("This event does not have paid tickets.");
    }

    const checkout = await this.#ticketing.startCheckout(event, interaction.user.id);
    await interaction.editReply(
      checkout.alreadyPaid
        ? buildTicketConfirmed(event)
        : buildTicketCheckout(event, checkout.checkoutUrl),
    );
  }

  async #cancelRsvp(interaction: ButtonInteraction, event: EventRecord): Promise<void> {
    const result = await this.#store.cancelRsvp(event.id, interaction.user.id);
    await interaction.editReply(buildCancellationComplete(event, result.changed));
    void this.#audit.flush();
  }

  #requireAdministrator(
    interaction:
      | ChatInputCommandInteraction
      | MessageContextMenuCommandInteraction
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

  async #requireAdmissionMessage(
    interaction: ButtonInteraction,
    event: EventRecord,
  ): Promise<void> {
    if (interaction.message.id === event.message_id) return;
    if (!(await this.#store.isEventAdmissionMessage(event.id, interaction.message.id))) {
      throw new Error("Use a ticket or RSVP button posted by Club Manager.");
    }
  }

  async #recordInterest(
    event: EventRecord,
    userId: string,
    kind: "rsvp" | "ticket",
  ): Promise<void> {
    if (await this.#store.recordInterest(event.id, userId, kind)) {
      void this.#audit.flush();
    }
  }

  #requireRsvpOpen(event: EventRecord): void {
    this.#requireAdmissionOpen(event, EventAdmissionClosedError);
  }

  #requireTicketSalesOpen(event: EventRecord): void {
    this.#requireAdmissionOpen(event, TicketSalesClosedError);
  }

  #requireAdmissionOpen(event: EventRecord, ClosedError: new () => Error): void {
    const now = currentTimestamp();
    if (typeof event.ends_at === "number" && event.ends_at <= now) {
      throw new EventFinishedError();
    }
    if (
      typeof event.ticket_sales_close_at === "number" &&
      event.ticket_sales_close_at <= now
    ) {
      throw new ClosedError();
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

  #ticketPriceCents(input: string): number | undefined {
    const value = input.trim();
    if (!value) return undefined;
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
      throw new Error("Ticket price must be an AUD amount with up to two decimals.");
    }
    const cents = Math.round(Number(value) * 100);
    if (cents < 50) {
      throw new Error("Ticket price must be at least A$0.50.");
    }
    if (cents > 10_000_000) {
      throw new Error("Ticket price cannot exceed A$100,000.");
    }
    return cents;
  }

  #capacity(input: string): number | undefined {
    const value = input.trim();
    if (!value) return undefined;
    if (!/^\d+$/.test(value)) {
      throw new Error("Capacity must be a whole number.");
    }
    const capacity = Number(value);
    if (capacity < 1 || capacity > 100_000) {
      throw new Error("Capacity must be between 1 and 100,000.");
    }
    return capacity;
  }
}

const eventButtonActions = [
  "publish",
  "discard",
  "buy",
  "rsvp",
  "rsvp-confirm",
  "cancel-confirm",
  "dismiss",
] as const;

type EventButtonAction = (typeof eventButtonActions)[number];

function isEventButtonAction(value: string): value is EventButtonAction {
  return (eventButtonActions as readonly string[]).includes(value);
}

function parseEventButton(
  customId: string,
): { action: EventButtonAction; eventId: number } | undefined {
  const match = /^event:([a-z-]+):(\d+)$/.exec(customId);
  if (!match?.[1]) return undefined;

  const action = match[1];
  const eventId = Number(match[2]);

  return isEventButtonAction(action) ? { action, eventId } : undefined;
}

function parseEventWizardStep(
  customId: string,
): { step: "details" | "schedule" | "admission"; token: string } | undefined {
  const match = /^event:create:(details|schedule|admission):([a-f0-9]{32})$/.exec(
    customId,
  );
  if (!match?.[1] || !match[2]) return undefined;
  return {
    step: match[1] as "details" | "schedule" | "admission",
    token: match[2],
  };
}

function safeAttachmentName(name: string): string {
  const sanitized = name
    .replaceAll(/[^a-zA-Z0-9._-]/g, "-")
    .replaceAll(/-+/g, "-")
    .slice(-100);
  return sanitized || "event-artwork.png";
}

function parseAnnouncementLink(
  value: string,
): { guildId: string; channelId: string; messageId: string } | undefined {
  const match =
    /^https:\/\/(?:(?:www|canary|ptb)\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/.exec(
      value.trim(),
    );
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  return { guildId: match[1], channelId: match[2], messageId: match[3] };
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
