import {
  type Attachment,
  AttachmentBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  MessageFlags,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
  type StringSelectMenuInteraction,
} from "discord.js";
import type {
  PayoutDetailsRecord,
  ReimbursementFilter,
  ReimbursementRecord,
  ReimbursementStatus,
  Store,
} from "./database.js";
import {
  buildPayoutModal,
  buildReimbursementDetail,
  buildReimbursementList,
  buildReimbursementManage,
  buildReimbursementModal,
  buildReimbursementsCsv,
  parseAccountNumber,
  parseAmountCents,
  parseBsb,
  parseReimbursementAdminId,
  REIMBURSEMENT_LIST_PAGE_SIZE,
  reimbursementIds,
  reimbursementLogContent,
} from "./reimbursement-ui.js";
import type { SettingsResolver } from "./settings.js";

// Attachments per Discord message; the export's first message also carries
// the CSV, so it fits one fewer receipt image.
const MAX_FILES_PER_MESSAGE = 10;

export class ReimbursementController {
  readonly #store: Store;
  readonly #settings: SettingsResolver;

  constructor(store: Store, settings: SettingsResolver) {
    this.#store = store;
    this.#settings = settings;
  }

  async handleCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (interaction.commandName !== "reimbursement") return false;
    this.#requireAdministrator(interaction);
    if (!interaction.guildId) {
      throw new Error("Reimbursements can only be managed inside a server.");
    }

    switch (interaction.options.getSubcommand()) {
      case "create":
        await interaction.showModal(buildReimbursementModal());
        return true;
      case "config": {
        const current = await this.#store.getPayoutDetails(
          interaction.guildId,
          interaction.user.id,
        );
        await interaction.showModal(buildPayoutModal(current));
        return true;
      }
      case "list": {
        const status = interaction.options.getString(
          "status",
        ) as ReimbursementStatus | null;
        const member = interaction.options.getUser("member");
        // With no options the invoker sees their own reimbursements; any
        // option switches to the treasurer view across members.
        const filter: ReimbursementFilter = {
          ...(status ? { status } : {}),
          ...(member
            ? { userId: member.id }
            : status
              ? {}
              : { userId: interaction.user.id }),
        };
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await this.#renderList(interaction, filter, 0);
        return true;
      }
      default:
        throw new Error("Unknown reimbursement subcommand.");
    }
  }

  async handleModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    const [scope, action, id] = interaction.customId.split(":");
    if (scope !== "reimb") return false;
    this.#requireAdministrator(interaction);
    if (!interaction.guildId) {
      throw new Error("Reimbursements can only be managed inside a server.");
    }

    if (action === "create") {
      await this.#createReimbursement(interaction);
      return true;
    }
    if (action === "edit") {
      await this.#editReimbursement(interaction, Number(id));
      return true;
    }
    if (action === "payout") {
      await this.#savePayoutDetails(
        interaction,
        id === undefined ? undefined : Number(id),
      );
      return true;
    }
    return false;
  }

  async handleButton(interaction: ButtonInteraction): Promise<boolean> {
    const admin = parseReimbursementAdminId(interaction.customId);
    if (admin) {
      this.#requireAdministrator(interaction);
      if (admin.action === "export") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await this.#exportCsv(interaction, admin.filter);
        return true;
      }
      await interaction.deferUpdate();
      if (admin.action === "page") {
        await this.#renderList(interaction, admin.filter, admin.value);
        return true;
      }
      if (admin.action === "submitted" || admin.action === "paid") {
        await this.#advanceStatus(interaction, admin.filter, admin.action, admin.value);
        return true;
      }
      if (admin.action === "manage") {
        await this.#renderManage(interaction, admin.filter, admin.value);
        return true;
      }
      return false;
    }

    const [scope, action, id] = interaction.customId.split(":");
    if (scope !== "reimb") return false;
    this.#requireAdministrator(interaction);
    if (!interaction.guildId) {
      throw new Error("Reimbursements can only be managed inside a server.");
    }

    if (action === "edit-open") {
      const reimbursement = await this.#store.getReimbursement(
        Number(id),
        interaction.guildId,
      );
      if (!reimbursement) {
        throw new Error("That reimbursement no longer exists.");
      }
      await interaction.showModal(buildReimbursementModal(reimbursement));
      return true;
    }
    if (action === "payout-open") {
      const current = await this.#store.getPayoutDetails(
        interaction.guildId,
        interaction.user.id,
      );
      await interaction.showModal(buildPayoutModal(current, Number(id)));
      return true;
    }
    return false;
  }

  async handleSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
    const admin = parseReimbursementAdminId(interaction.customId);
    if (admin?.action !== "select") return false;
    this.#requireAdministrator(interaction);
    await interaction.deferUpdate();
    await this.#renderManage(interaction, admin.filter, Number(interaction.values[0]));
    return true;
  }

  async #createReimbursement(interaction: ModalSubmitInteraction): Promise<void> {
    if (!interaction.guildId) throw new Error("Missing guild.");
    const details = this.#readDetailFields(interaction);
    const receipt = interaction.fields
      .getUploadedFiles(reimbursementIds.receipt, true)
      .first();
    if (!receipt) {
      throw new Error("Upload a receipt image.");
    }
    this.#validateReceipt(receipt);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let reimbursement = await this.#store.createReimbursement({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      eventName: details.eventName,
      ...(details.description ? { description: details.description } : {}),
      ...(details.amountCents !== undefined ? { amountCents: details.amountCents } : {}),
      receiptUrl: receipt.url,
      receiptName: receipt.name,
    });

    const logged = await this.#postReceiptLog(interaction.client, reimbursement, receipt);
    if (logged) reimbursement = logged;

    const payout = await this.#store.getPayoutDetails(
      interaction.guildId,
      interaction.user.id,
    );
    const view = buildReimbursementDetail(reimbursement, payout);
    const note = reimbursement.log_message_id
      ? ""
      : "\n-# ⚠️ No reimbursement log channel is set (see `/config`), so the receipt link will expire.";
    await interaction.editReply({ ...view, content: `${view.content}${note}` });
  }

  async #editReimbursement(
    interaction: ModalSubmitInteraction,
    id: number,
  ): Promise<void> {
    if (!interaction.guildId) throw new Error("Missing guild.");
    const existing = await this.#store.getReimbursement(id, interaction.guildId);
    if (!existing) {
      throw new Error("That reimbursement no longer exists.");
    }
    const details = this.#readDetailFields(interaction);
    const receipt = interaction.fields
      .getUploadedFiles(reimbursementIds.receipt, false)
      ?.first();
    if (receipt) this.#validateReceipt(receipt);

    if (interaction.isFromMessage()) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    let logRef: { logChannelId?: string; logMessageId?: string } = {};
    let receiptUrl = receipt?.url;
    if (receipt) {
      // A replaced receipt gets a fresh log message so the old image stays in
      // the channel history; the record then points at the new message.
      const posted = await this.#postReceiptLog(
        interaction.client,
        { ...existing, ...detailsAsRecord(details) },
        receipt,
      );
      if (posted) {
        logRef = {
          ...(posted.log_channel_id ? { logChannelId: posted.log_channel_id } : {}),
          ...(posted.log_message_id ? { logMessageId: posted.log_message_id } : {}),
        };
        receiptUrl = posted.receipt_url;
      }
    }

    const updated = await this.#store.updateReimbursementDetails(
      id,
      interaction.guildId,
      {
        eventName: details.eventName,
        description: details.description ?? null,
        amountCents: details.amountCents ?? null,
        ...(receipt && receiptUrl
          ? { receipt: { url: receiptUrl, name: receipt.name, ...logRef } }
          : {}),
      },
    );
    if (!updated) {
      throw new Error("That reimbursement no longer exists.");
    }
    if (!receipt) {
      await this.#syncReceiptLog(interaction.client, updated);
    }

    const payout = await this.#store.getPayoutDetails(
      interaction.guildId,
      updated.user_id,
    );
    await interaction.editReply(buildReimbursementDetail(updated, payout));
  }

  async #savePayoutDetails(
    interaction: ModalSubmitInteraction,
    reimbursementId: number | undefined,
  ): Promise<void> {
    if (!interaction.guildId) throw new Error("Missing guild.");
    const accountName = interaction.fields
      .getTextInputValue(reimbursementIds.accountName)
      .trim();
    if (!accountName) {
      throw new Error("Enter the account holder name.");
    }
    const bsb = parseBsb(interaction.fields.getTextInputValue(reimbursementIds.bsb));
    const accountNumber = parseAccountNumber(
      interaction.fields.getTextInputValue(reimbursementIds.accountNumber),
    );

    const fromDetailView = interaction.isFromMessage() && reimbursementId !== undefined;
    if (fromDetailView) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    const payout = await this.#store.upsertPayoutDetails(
      interaction.guildId,
      interaction.user.id,
      { accountName, bsb, accountNumber },
    );

    if (fromDetailView) {
      const reimbursement = await this.#store.getReimbursement(
        reimbursementId,
        interaction.guildId,
      );
      if (reimbursement) {
        await interaction.editReply(buildReimbursementDetail(reimbursement, payout));
        return;
      }
    }
    await interaction.editReply({
      content: `✅ Payout details saved: ${payout.account_name} · BSB ${payout.bsb} · Acct ${payout.account_number}`,
      components: [],
    });
  }

  async #advanceStatus(
    interaction: ButtonInteraction,
    filter: ReimbursementFilter,
    to: "submitted" | "paid",
    id: number,
  ): Promise<void> {
    if (!interaction.guildId) {
      throw new Error("Reimbursements can only be managed inside a server.");
    }
    const advanced = await this.#store.advanceReimbursementStatus(
      id,
      interaction.guildId,
      to,
    );
    if (advanced) {
      await this.#syncReceiptLog(interaction.client, advanced);
    }
    // When the transition was invalid (already advanced elsewhere) fall
    // through to re-rendering the current state.
    await this.#renderManage(interaction, filter, id);
  }

  async #renderList(
    interaction:
      | ChatInputCommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction,
    filter: ReimbursementFilter,
    offset: number,
  ): Promise<void> {
    if (!interaction.guildId) {
      throw new Error("Reimbursements can only be listed inside a server.");
    }
    const { reimbursements, total } = await this.#store.listReimbursements(
      interaction.guildId,
      filter,
      offset,
      REIMBURSEMENT_LIST_PAGE_SIZE,
    );
    await interaction.editReply(
      buildReimbursementList(reimbursements, total, offset, filter, interaction.user.id),
    );
  }

  async #renderManage(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    filter: ReimbursementFilter,
    id: number,
  ): Promise<void> {
    if (!interaction.guildId) {
      throw new Error("Reimbursements can only be managed inside a server.");
    }
    const reimbursement = await this.#store.getReimbursement(id, interaction.guildId);
    if (!reimbursement) {
      await interaction.editReply({
        content: "That reimbursement no longer exists.",
        embeds: [],
        components: [],
      });
      return;
    }
    const payout = await this.#store.getPayoutDetails(
      interaction.guildId,
      reimbursement.user_id,
    );
    await interaction.editReply(buildReimbursementManage(reimbursement, payout, filter));
  }

  async #exportCsv(
    interaction: ButtonInteraction,
    filter: ReimbursementFilter,
  ): Promise<void> {
    if (!interaction.guildId) {
      throw new Error("Reimbursements can only be exported inside a server.");
    }
    const reimbursements = await this.#store.listAllReimbursements(
      interaction.guildId,
      filter,
    );
    if (reimbursements.length === 0) {
      await interaction.editReply({ content: "Nothing to export for this filter." });
      return;
    }

    const payoutsByUser = new Map<string, PayoutDetailsRecord>();
    for (const userId of new Set(reimbursements.map((r) => r.user_id))) {
      const payout = await this.#store.getPayoutDetails(interaction.guildId, userId);
      if (payout) payoutsByUser.set(userId, payout);
    }

    const missingReceipts: number[] = [];
    const images: AttachmentBuilder[] = [];
    for (const reimbursement of reimbursements) {
      const url = await this.#freshReceiptUrl(interaction.client, reimbursement);
      if (!url) {
        missingReceipts.push(reimbursement.id);
        continue;
      }
      images.push(
        new AttachmentBuilder(url, {
          name: `reimbursement-${reimbursement.id}-${reimbursement.receipt_name}`,
        }),
      );
    }

    const csv = buildReimbursementsCsv(reimbursements, payoutsByUser);
    const summary = [
      `📄 Exported ${reimbursements.length} reimbursement${reimbursements.length === 1 ? "" : "s"} with ${images.length} receipt image${images.length === 1 ? "" : "s"}.`,
      missingReceipts.length > 0
        ? `-# ⚠️ Receipts unavailable for #${missingReceipts.join(", #")}.`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const firstBatch = images.slice(0, MAX_FILES_PER_MESSAGE - 1);
    await interaction.editReply({
      content: summary,
      files: [
        new AttachmentBuilder(Buffer.from(`${csv}\n`, "utf8"), {
          name: "reimbursements.csv",
        }),
        ...firstBatch,
      ],
    });
    for (
      let start = firstBatch.length;
      start < images.length;
      start += MAX_FILES_PER_MESSAGE
    ) {
      await interaction.followUp({
        files: images.slice(start, start + MAX_FILES_PER_MESSAGE),
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // Posts the receipt to the configured log channel and stores the durable
  // message reference. Returns the updated record, or undefined when no log
  // channel is configured or the post failed (the reimbursement still exists;
  // it just keeps the short-lived upload URL).
  async #postReceiptLog(
    client: Client,
    reimbursement: ReimbursementRecord,
    receipt: Attachment,
  ): Promise<ReimbursementRecord | undefined> {
    if (!reimbursement.guild_id) return undefined;
    const { reimbursementLogChannelId } = await this.#settings.resolve(
      reimbursement.guild_id,
    );
    if (!reimbursementLogChannelId) return undefined;

    try {
      const channel = await client.channels.fetch(reimbursementLogChannelId);
      if (!channel?.isSendable()) {
        throw new Error("channel is not sendable");
      }
      const message = await channel.send({
        content: reimbursementLogContent(reimbursement),
        files: [new AttachmentBuilder(receipt.url, { name: receipt.name })],
      });
      const posted = message.attachments.first();
      return await this.#store.updateReimbursementDetails(
        reimbursement.id,
        reimbursement.guild_id,
        {
          eventName: reimbursement.event_name,
          description: reimbursement.description,
          amountCents: reimbursement.amount_cents,
          receipt: {
            url: posted?.url ?? receipt.url,
            name: receipt.name,
            logChannelId: message.channelId,
            logMessageId: message.id,
          },
        },
      );
    } catch (error) {
      console.error(
        `Failed to post reimbursement ${reimbursement.id} to the log channel`,
        error,
      );
      return undefined;
    }
  }

  // Keeps the log message's status/details line in step with the record.
  async #syncReceiptLog(
    client: Client,
    reimbursement: ReimbursementRecord,
  ): Promise<void> {
    if (!reimbursement.log_channel_id || !reimbursement.log_message_id) return;
    try {
      const channel = await client.channels.fetch(reimbursement.log_channel_id);
      if (!channel?.isTextBased()) return;
      const message = await channel.messages.fetch(reimbursement.log_message_id);
      await message.edit({ content: reimbursementLogContent(reimbursement) });
    } catch (error) {
      console.error(
        `Failed to update the log message for reimbursement ${reimbursement.id}`,
        error,
      );
    }
  }

  // Receipt URLs from Discord's CDN expire, so exports refetch the log
  // message for a freshly signed link before falling back to the stored URL.
  async #freshReceiptUrl(
    client: Client,
    reimbursement: ReimbursementRecord,
  ): Promise<string | undefined> {
    if (reimbursement.log_channel_id && reimbursement.log_message_id) {
      try {
        const channel = await client.channels.fetch(reimbursement.log_channel_id);
        if (channel?.isTextBased()) {
          const message = await channel.messages.fetch(reimbursement.log_message_id);
          const attachment = message.attachments.first();
          if (attachment) return attachment.url;
        }
      } catch (error) {
        console.error(
          `Failed to fetch the receipt for reimbursement ${reimbursement.id}`,
          error,
        );
      }
    }
    return reimbursement.receipt_url || undefined;
  }

  #readDetailFields(interaction: ModalSubmitInteraction): {
    eventName: string;
    description?: string;
    amountCents?: number;
  } {
    const eventName = interaction.fields
      .getTextInputValue(reimbursementIds.eventName)
      .trim();
    if (!eventName) {
      throw new Error("Enter the event name.");
    }
    const description = interaction.fields
      .getTextInputValue(reimbursementIds.description)
      .trim();
    const amountCents = parseAmountCents(
      interaction.fields.getTextInputValue(reimbursementIds.amount),
    );
    return {
      eventName,
      ...(description ? { description } : {}),
      ...(amountCents !== undefined ? { amountCents } : {}),
    };
  }

  #validateReceipt(receipt: Attachment): void {
    if (!receipt.contentType?.startsWith("image/")) {
      throw new Error("The receipt must be an image.");
    }
  }

  #requireAdministrator(
    interaction:
      | ChatInputCommandInteraction
      | ModalSubmitInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction,
  ): void {
    if (
      !interaction.inGuild() ||
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    ) {
      throw new Error("Only server administrators can manage reimbursements.");
    }
  }
}

function detailsAsRecord(details: {
  eventName: string;
  description?: string;
  amountCents?: number;
}): Pick<ReimbursementRecord, "event_name" | "description" | "amount_cents"> {
  return {
    event_name: details.eventName,
    description: details.description ?? null,
    amount_cents: details.amountCents ?? null,
  };
}
