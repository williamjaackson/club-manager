import { randomBytes } from "node:crypto";
import {
  ActionRowBuilder,
  type Attachment,
  AttachmentBuilder,
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
  type StringSelectMenuInteraction,
  type TextChannel,
  type Webhook,
  type WebhookType,
} from "discord.js";
import type { AuditLogger } from "./audit.js";
import {
  buildConfigModal,
  configIds,
  configModalId,
  describeSettings,
} from "./config-ui.js";
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
  buildAttendeeList,
  buildAttendeesCsv,
  buildCancelConfirm,
  buildDeleteConfirm,
  buildEventList,
  buildEventManageView,
  EVENT_LIST_PAGE_SIZE,
  eventAdminIds,
} from "./event-admin-ui.js";
import {
  buildAdmissionComponents,
  buildCancellationComplete,
  buildCreateEventAdmissionModal,
  buildCreateEventDetailsModal,
  buildCreateEventScheduleModal,
  buildCurrentRsvp,
  buildEditRefundConfirm,
  buildEventAnnouncementText,
  buildEventPreview,
  buildPublicEventMessage,
  buildReminderMessage,
  buildRsvpComplete,
  buildRsvpPrompt,
  buildTicketCheckout,
  buildTicketConfirmed,
  buildWizardHub,
  eventIds,
} from "./event-ui.js";
import { findOrCreateEventWebhook } from "./event-webhook.js";
import type { ResolvedGuildSettings, SettingsManager } from "./settings.js";
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
  readonly #settings: SettingsManager;
  readonly #refresher: { markDirty(eventId: number): void };
  readonly #webhookLookups = new Map<string, Promise<Webhook<WebhookType.Incoming>>>();

  constructor(
    store: Store,
    audit: AuditLogger,
    ticketing: TicketingService,
    settings: SettingsManager = {
      resolve: async () => ({}),
      update: async () => ({}),
    },
    refresher: { markDirty(eventId: number): void } = { markDirty() {} },
  ) {
    this.#store = store;
    this.#audit = audit;
    this.#ticketing = ticketing;
    this.#settings = settings;
    this.#refresher = refresher;
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

    if (interaction.commandName === "config") {
      this.#requireAdministrator(interaction);
      if (!interaction.guildId) {
        throw new Error("Settings can only be changed inside a server.");
      }
      const current = await this.#settings.resolve(interaction.guildId);
      await interaction.showModal(buildConfigModal(current));
      return true;
    }

    if (interaction.commandName !== "event") return false;

    if (interaction.options.getSubcommand() === "list") {
      this.#requireAdministrator(interaction);
      if (!interaction.guildId) {
        throw new Error("Events can only be listed inside a server.");
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await this.#renderEventList(interaction, 0);
      return true;
    }

    if (interaction.options.getSubcommand() !== "create") {
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
    if (interaction.commandName === "Edit Event") {
      await this.#startEventEdit(interaction);
      return true;
    }
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

    const failedUpdates = await this.#refreshEventMessages(
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

  async #refreshEventMessages(
    interaction: MessageContextMenuCommandInteraction | ButtonInteraction,
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

    const attendance = await this.#store.getEventAttendance(event.id);
    const components = buildAdmissionComponents(event, undefined, attendance);
    const updates: Promise<unknown>[] = [];
    if (event.message_id) {
      updates.push(
        this.#getOrCreateEventWebhook(channel, interaction.client.user.id).then(
          (webhook) =>
            webhook.editMessage(event.message_id!, {
              content: buildEventAnnouncementText(event, attendance),
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
    if (interaction.customId === configModalId) {
      await this.#saveConfig(interaction);
      return true;
    }

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
        await this.#saveEventAdmission(interaction, parsed.token);
        return true;
    }
  }

  async #saveConfig(interaction: ModalSubmitInteraction): Promise<void> {
    this.#requireAdministrator(interaction);
    if (!interaction.guildId) {
      throw new Error("Settings can only be changed inside a server.");
    }

    const channel = interaction.fields
      .getSelectedChannels(configIds.logChannel, true, [ChannelType.GuildText])
      .first();
    if (!channel) {
      throw new Error("Select a channel for the RSVP log.");
    }
    const connectedRole = interaction.fields
      .getSelectedRoles(configIds.connectedRole, false)
      ?.first();
    const exemptRole = interaction.fields
      .getSelectedRoles(configIds.exemptRole, false)
      ?.first();
    const verificationUrl = optionalHttpsUrl(
      interaction.fields.getTextInputValue(configIds.verificationUrl),
      "Verification message link",
    );

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const saved = await this.#settings.update(interaction.guildId, {
      rsvpLogChannelId: channel.id,
      ...(connectedRole ? { connectedRoleId: connectedRole.id } : {}),
      ...(exemptRole ? { exemptRoleId: exemptRole.id } : {}),
      ...(verificationUrl ? { verificationMessageUrl: verificationUrl } : {}),
    });
    await interaction.editReply({ content: describeSettings(saved), components: [] });
  }

  async #startEventEdit(
    interaction: MessageContextMenuCommandInteraction,
  ): Promise<void> {
    this.#requireAdministrator(interaction);
    if (!interaction.guildId) {
      throw new Error("Events can only be edited inside a server.");
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const event = await this.#store.getEventByAdmissionMessageId(
      interaction.guildId,
      interaction.targetMessage.id,
    );
    if (event?.status !== "published" || !event.message_id) {
      throw new Error("Use Edit Event on an event announcement or reminder.");
    }

    const token = randomBytes(16).toString("hex");
    const seed: NewPendingEventCreate = {
      token,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      editEventId: event.id,
      announcementChannelId: event.announcement_channel_id,
      title: event.title,
      location: event.location,
      announcement: event.announcement,
      testMode: event.test_mode,
    };
    if (event.location_url) seed.locationUrl = event.location_url;
    if (event.artwork_url) seed.artworkUrl = event.artwork_url;
    if (event.artwork_name) seed.artworkName = event.artwork_name;
    if (typeof event.starts_at === "number") seed.startsAt = event.starts_at;
    if (typeof event.ends_at === "number") seed.endsAt = event.ends_at;
    if (typeof event.ticket_sales_close_at === "number") {
      seed.ticketSalesCloseAt = event.ticket_sales_close_at;
    }
    if (typeof event.ticket_price_cents === "number") {
      seed.ticketPriceCents = event.ticket_price_cents;
      seed.ticketCurrency = event.ticket_currency ?? "aud";
    }
    if (typeof event.ticket_limit === "number") seed.ticketLimit = event.ticket_limit;

    await this.#store.createPendingEventCreate(seed);
    const pending = await this.#store.getPendingEventCreate(token);
    if (!pending) {
      throw new Error("The edit form could not be created. Try again.");
    }
    await interaction.editReply(buildWizardHub(pending));
  }

  // Wizard modals opened from the hub edit the hub message in place; the
  // very first details modal (opened by /event create) creates it.
  async #deferWizardModal(interaction: ModalSubmitInteraction): Promise<void> {
    if (interaction.isFromMessage()) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
  }

  async #renderWizardHub(
    interaction: ModalSubmitInteraction | ButtonInteraction,
    token: string,
  ): Promise<void> {
    const pending = await this.#pendingEventWizard(interaction, token);
    if (!pending) {
      await this.#eventWizardExpired(interaction);
      return;
    }
    await interaction.editReply(buildWizardHub(pending));
  }

  async #saveEventDetails(
    interaction: ModalSubmitInteraction,
    token: string,
  ): Promise<void> {
    await this.#deferWizardModal(interaction);
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
    await this.#renderWizardHub(interaction, token);
  }

  async #saveEventSchedule(
    interaction: ModalSubmitInteraction,
    token: string,
  ): Promise<void> {
    const existing = await this.#pendingEventWizard(interaction, token);
    if (!existing) {
      await interaction.reply({
        content: "This event form expired. Run `/event create` again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const isEdit = typeof existing.edit_event_id === "number";

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
    const locationUrl = optionalHttpsUrl(
      interaction.fields.getTextInputValue(eventIds.locationUrl),
      "Google Maps link",
    );
    // Edits may describe an event that is already underway; only new events
    // must be scheduled in the future.
    if (!isEdit && startsAt <= currentTimestamp()) {
      throw new Error("Start time must be in the future.");
    }
    if (endsAt !== undefined && endsAt <= startsAt) {
      throw new Error("Finish time must be after the start time.");
    }
    if (!isEdit && endsAt !== undefined && endsAt <= currentTimestamp()) {
      throw new Error("Finish time must be in the future.");
    }
    if (
      !isEdit &&
      ticketSalesCloseAt !== undefined &&
      ticketSalesCloseAt <= currentTimestamp()
    ) {
      throw new Error("Ticket sales close must be in the future.");
    }
    if (
      endsAt !== undefined &&
      ticketSalesCloseAt !== undefined &&
      ticketSalesCloseAt >= endsAt
    ) {
      throw new Error("Ticket sales close must be earlier than the finish time.");
    }

    await this.#deferWizardModal(interaction);
    const saved = await this.#store.updatePendingEventSchedule(
      token,
      interaction.user.id,
      interaction.guildId,
      {
        startsAt,
        ...(endsAt !== undefined ? { endsAt } : {}),
        ...(ticketSalesCloseAt !== undefined ? { ticketSalesCloseAt } : {}),
        ...(locationUrl !== undefined ? { locationUrl } : {}),
      },
    );
    if (!saved) {
      await this.#eventWizardExpired(interaction);
      return;
    }
    await this.#renderWizardHub(interaction, token);
  }

  async #saveEventAdmission(
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
    if (testMode && ticketPriceCents === undefined) {
      throw new Error("Stripe test events require a paid ticket price.");
    }

    await this.#deferWizardModal(interaction);
    const saved = await this.#store.updatePendingEventAdmission(
      token,
      interaction.user.id,
      interaction.guildId,
      {
        ...(ticketPriceCents !== undefined
          ? { ticketPriceCents, ticketCurrency: "aud" }
          : {}),
        ...(capacity !== undefined ? { ticketLimit: capacity } : {}),
        testMode,
      },
    );
    if (!saved) {
      await this.#eventWizardExpired(interaction);
      return;
    }
    await this.#renderWizardHub(interaction, token);
  }

  async #finishEventWizard(
    interaction: ButtonInteraction,
    token: string,
    editConfirmed = false,
  ): Promise<void> {
    await interaction.deferUpdate();
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
    if (pending.ticket_sales_close_at !== null && pending.ticket_price_cents === null) {
      throw new Error("Ticket sales close requires a paid ticket price.");
    }
    if (pending.test_mode && pending.ticket_price_cents === null) {
      throw new Error("Stripe test events require a paid ticket price.");
    }

    if (typeof pending.edit_event_id === "number") {
      await this.#applyEventEdit(interaction, pending, editConfirmed);
      return;
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
    if (pending.location_url) draft.locationUrl = pending.location_url;
    if (pending.artwork_url) draft.artworkUrl = pending.artwork_url;
    if (pending.artwork_name) draft.artworkName = pending.artwork_name;
    if (pending.ticket_price_cents !== null) {
      draft.ticketPriceCents = pending.ticket_price_cents;
      draft.ticketCurrency = pending.ticket_currency ?? "aud";
    }
    if (pending.ticket_limit !== null) draft.ticketLimit = pending.ticket_limit;
    if (pending.test_mode) draft.testMode = true;
    if (pending.ticket_sales_close_at !== null) {
      draft.ticketSalesCloseAt = pending.ticket_sales_close_at;
    }

    const event = await this.#store.createEventDraft(draft);
    await interaction.editReply(buildEventPreview(event));
  }

  async #applyEventEdit(
    interaction: ButtonInteraction,
    pending: PendingEventCreateRecord,
    editConfirmed: boolean,
  ): Promise<void> {
    if (
      typeof pending.edit_event_id === "number" &&
      typeof pending.ticket_price_cents === "number" &&
      !editConfirmed
    ) {
      const preview = await this.#store.previewPriceDropRefunds(
        pending.edit_event_id,
        pending.ticket_price_cents,
      );
      if (preview.count > 0) {
        await interaction.editReply(
          buildEditRefundConfirm(pending, preview.totalCents, preview.count),
        );
        return;
      }
    }

    const { event, refunds } = await this.#store.applyEventEdit(pending);
    await this.#store.deletePendingEventCreate(pending.token);

    let refundSummary = "";
    if (refunds.length > 0) {
      const { refunded, failed } = await this.#ticketing.refundPriceDifferences(
        event,
        refunds,
      );
      void this.#audit.flush();
      refundSummary = ` Refunded the price difference on ${refunded} ticket${
        refunded === 1 ? "" : "s"
      }.`;
      if (failed > 0) {
        refundSummary += ` ⚠️ ${failed} refund${
          failed === 1 ? "" : "s"
        } failed — save the edit again to retry, or handle them in the Stripe dashboard.`;
      }
    }

    const failedUpdates = await this.#refreshEventMessages(interaction, event).catch(
      (error) => {
        console.error("Failed to refresh edited event messages", error);
        return 1;
      },
    );
    await interaction.editReply({
      content:
        `✅ Updated **${event.title}**. The announcement has been refreshed.` +
        refundSummary +
        (failedUpdates > 0
          ? " Some existing messages could not be updated visually."
          : ""),
      embeds: [],
      components: [],
    });
  }

  async #abortEventWizard(interaction: ButtonInteraction, token: string): Promise<void> {
    await interaction.deferUpdate();
    await this.#store.deletePendingEventCreate(token);
    await interaction.editReply({
      content: "Event form discarded. Run `/event create` to start again.",
      components: [],
    });
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

  async #handleAdminAction(
    interaction: ButtonInteraction,
    action: EventAdminAction,
    value: number,
  ): Promise<void> {
    if (action === "page") {
      await this.#renderEventList(interaction, value);
      return;
    }

    const event = await this.#store.getEvent(value);
    if (!event || event.guild_id !== interaction.guildId) {
      await interaction.editReply({
        content: "That event no longer exists.",
        embeds: [],
        components: [],
      });
      return;
    }

    switch (action) {
      case "manage":
        await this.#renderEventManage(interaction, event.id);
        return;
      case "attendees": {
        const attendees = await this.#store.getEventAttendees(event.id);
        await interaction.editReply(buildAttendeeList(event, attendees));
        return;
      }
      case "csv": {
        const attendees = await this.#store.getEventAttendees(event.id);
        const csv = buildAttendeesCsv(event, attendees);
        await interaction.editReply({
          content: `📄 ${attendees.length} row${attendees.length === 1 ? "" : "s"} exported.`,
          files: [
            new AttachmentBuilder(Buffer.from(`${csv}\n`, "utf8"), {
              name: `event-${event.id}-attendees.csv`,
            }),
          ],
        });
        return;
      }
      case "cancel": {
        const preview = await this.#store.previewPriceDropRefunds(event.id, 0);
        await interaction.editReply(
          buildCancelConfirm(event, preview.count, preview.totalCents),
        );
        return;
      }
      case "cancel-confirm":
        await this.#cancelEvent(interaction, event);
        return;
      case "delete": {
        const attendance = await this.#store.getEventAttendance(event.id);
        const hasPaidTickets = event.ticket_price_cents !== null && attendance.going > 0;
        await interaction.editReply(
          buildDeleteConfirm(event, attendance, hasPaidTickets),
        );
        return;
      }
      case "delete-confirm": {
        const deleted = await this.#store.deleteEventCascade(event.id);
        await interaction.editReply({
          content: deleted
            ? `🗑️ Deleted **${event.title}** and all of its records from the database.`
            : "That event was already deleted.",
          embeds: [],
          components: [],
        });
        return;
      }
    }
  }

  async #renderEventList(
    interaction: ButtonInteraction | ChatInputCommandInteraction,
    offset: number,
  ): Promise<void> {
    if (!interaction.guildId) {
      throw new Error("Events can only be listed inside a server.");
    }
    const { events, total } = await this.#store.listEvents(
      interaction.guildId,
      offset,
      EVENT_LIST_PAGE_SIZE,
    );
    await interaction.editReply(buildEventList(events, total, offset));
  }

  async #renderEventManage(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    eventId: number,
  ): Promise<void> {
    const event = await this.#store.getEvent(eventId);
    if (!event || event.guild_id !== interaction.guildId) {
      await interaction.editReply({
        content: "That event no longer exists.",
        embeds: [],
        components: [],
      });
      return;
    }
    const attendance = await this.#store.getEventAttendance(eventId);
    await interaction.editReply(buildEventManageView(event, attendance));
  }

  async #cancelEvent(interaction: ButtonInteraction, event: EventRecord): Promise<void> {
    const cancelled = await this.#store.cancelEvent(event.id);
    if (!cancelled) {
      await interaction.editReply({
        content: `**${event.title}** is already cancelled or not published.`,
        embeds: [],
        components: [],
      });
      return;
    }

    let refundSummary = "";
    if (cancelled.refunds.length > 0) {
      const { refunded, failed } = await this.#ticketing.refundCancelledEventOrders(
        cancelled.event,
        cancelled.refunds,
      );
      refundSummary = ` Started full refunds for ${refunded} ticket${
        refunded === 1 ? "" : "s"
      }.`;
      if (failed > 0) {
        refundSummary += ` ⚠️ ${failed} refund${
          failed === 1 ? "" : "s"
        } failed — handle them in the Stripe dashboard.`;
      }
    }
    void this.#audit.flush();

    const failedUpdates = await this.#refreshEventMessages(
      interaction,
      cancelled.event,
    ).catch((error) => {
      console.error("Failed to refresh cancelled event messages", error);
      return 1;
    });
    await interaction.editReply({
      content:
        `❌ Cancelled **${event.title}**. Attendees are being notified by DM.` +
        refundSummary +
        (failedUpdates > 0
          ? " Some existing messages could not be updated visually."
          : ""),
      embeds: [],
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

  async handleSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
    if (interaction.customId !== eventAdminIds.select) return false;

    this.#requireAdministrator(interaction);
    await interaction.deferUpdate();
    const eventId = Number(interaction.values[0]);
    await this.#renderEventManage(interaction, eventId);
    return true;
  }

  async handleButton(interaction: ButtonInteraction): Promise<boolean> {
    const admin = parseEventAdminButton(interaction.customId);
    if (admin) {
      this.#requireAdministrator(interaction);
      await interaction.deferUpdate();
      await this.#handleAdminAction(interaction, admin.action, admin.value);
      return true;
    }

    const wizard = parseEventWizardAction(interaction.customId);
    if (wizard) {
      this.#requireAdministrator(interaction);

      if (wizard.action === "finish") {
        await this.#finishEventWizard(interaction, wizard.token);
        return true;
      }
      if (wizard.action === "confirm-apply") {
        await this.#finishEventWizard(interaction, wizard.token, true);
        return true;
      }
      if (wizard.action === "back") {
        await interaction.deferUpdate();
        await this.#renderWizardHub(interaction, wizard.token);
        return true;
      }
      if (wizard.action === "abort") {
        await this.#abortEventWizard(interaction, wizard.token);
        return true;
      }

      const pending = await this.#pendingEventWizard(interaction, wizard.token);
      if (!pending) {
        await interaction.reply({
          content: "This event form expired. Run `/event create` again.",
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      await interaction.showModal(
        wizard.action === "edit-details"
          ? buildCreateEventDetailsModal(wizard.token, pending)
          : wizard.action === "edit-schedule"
            ? buildCreateEventScheduleModal(wizard.token, pending)
            : buildCreateEventAdmissionModal(wizard.token, pending),
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
        ...buildPublicEventMessage(event, { going: 0 }),
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

    const lookup = findOrCreateEventWebhook(channel, botUserId);
    this.#webhookLookups.set(channel.id, lookup);

    try {
      return await lookup;
    } finally {
      if (this.#webhookLookups.get(channel.id) === lookup) {
        this.#webhookLookups.delete(channel.id);
      }
    }
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

    if (!(await this.#canRsvp(interaction))) {
      await interaction.editReply(await this.#verificationRequiredReply(interaction));
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

    if (!(await this.#canRsvp(interaction))) {
      await interaction.editReply(await this.#verificationRequiredReply(interaction));
      return;
    }

    const result = await this.#store.confirmRsvp(event.id, interaction.user.id);
    await interaction.editReply(buildRsvpComplete(event, result.changed));
    if (result.changed) this.#refresher.markDirty(event.id);
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

    if (!(await this.#canRsvp(interaction))) {
      await interaction.editReply(await this.#verificationRequiredReply(interaction));
      return;
    }

    if (!event.ticket_price_cents || !event.ticket_currency) {
      throw new Error("This event does not have paid tickets.");
    }

    const checkout = await this.#ticketing.startCheckout(event, interaction.user.id);
    if (!checkout.alreadyPaid) this.#refresher.markDirty(event.id);
    await interaction.editReply(
      checkout.alreadyPaid
        ? buildTicketConfirmed(event)
        : buildTicketCheckout(event, checkout.checkoutUrl),
    );
  }

  async #cancelRsvp(interaction: ButtonInteraction, event: EventRecord): Promise<void> {
    const result = await this.#store.cancelRsvp(event.id, interaction.user.id);
    await interaction.editReply(buildCancellationComplete(event, result.changed));
    if (result.changed) this.#refresher.markDirty(event.id);
    void this.#audit.flush();
  }

  #requireAdministrator(
    interaction:
      | ChatInputCommandInteraction
      | MessageContextMenuCommandInteraction
      | ModalSubmitInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction,
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

  async #canRsvp(interaction: ButtonInteraction): Promise<boolean> {
    const settings = await this.#guildSettings(interaction);
    const allowedRoleIds = [settings.connectedRoleId, settings.exemptRoleId].filter(
      (roleId): roleId is string => Boolean(roleId),
    );
    // With no verification roles configured, every member may respond.
    if (allowedRoleIds.length === 0) return true;

    const roles = interaction.member?.roles;
    if (!roles) return false;

    return Array.isArray(roles)
      ? allowedRoleIds.some((roleId) => roles.includes(roleId))
      : allowedRoleIds.some((roleId) => roles.cache.has(roleId));
  }

  async #guildSettings(interaction: ButtonInteraction): Promise<ResolvedGuildSettings> {
    return interaction.guildId ? this.#settings.resolve(interaction.guildId) : {};
  }

  async #verificationRequiredReply(
    interaction: ButtonInteraction,
  ): Promise<{ content: string; embeds: []; components: [] }> {
    const settings = await this.#guildSettings(interaction);
    return {
      content: settings.verificationMessageUrl
        ? `Hey, please verify first, then try again: ${settings.verificationMessageUrl}`
        : "Hey, please verify first, then try again. Ask an administrator where to verify.",
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

const eventAdminActions = [
  "page",
  "manage",
  "attendees",
  "csv",
  "cancel",
  "cancel-confirm",
  "delete",
  "delete-confirm",
] as const;

type EventAdminAction = (typeof eventAdminActions)[number];

function parseEventAdminButton(
  customId: string,
): { action: EventAdminAction; value: number } | undefined {
  const match = /^event-admin:([a-z-]+):(\d+)$/.exec(customId);
  if (!match?.[1]) return undefined;
  const action = match[1];
  if (!(eventAdminActions as readonly string[]).includes(action)) return undefined;
  return { action: action as EventAdminAction, value: Number(match[2]) };
}

type WizardButtonAction =
  | "edit-details"
  | "edit-schedule"
  | "edit-admission"
  | "finish"
  | "confirm-apply"
  | "back"
  | "abort";

function parseEventWizardAction(
  customId: string,
): { action: WizardButtonAction; token: string } | undefined {
  const match =
    /^event:create:(edit-details|edit-schedule|edit-admission|finish|confirm-apply|back|abort):([a-f0-9]{32})$/.exec(
      customId,
    );
  if (!match?.[1] || !match[2]) return undefined;
  return { action: match[1] as WizardButtonAction, token: match[2] };
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

function optionalHttpsUrl(value: string, fieldName: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${fieldName} must be a valid https:// link.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${fieldName} must be a valid https:// link.`);
  }
  return parsed.toString();
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
