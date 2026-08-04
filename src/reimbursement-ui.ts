import {
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
} from "@discordjs/builders";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  TextInputStyle,
} from "discord.js";
import type {
  PayoutDetailsRecord,
  ReimbursementFilter,
  ReimbursementRecord,
  ReimbursementStatus,
} from "./database.js";
import type { EventReplyOptions } from "./event-ui.js";
import { formatCurrencyAmount } from "./money.js";
import { buildPagerRow, pageHeading } from "./pagination.js";

export const REIMBURSEMENT_LIST_PAGE_SIZE = 5;

export const reimbursementIds = {
  eventName: "reimb-event-name",
  description: "reimb-description",
  amount: "reimb-amount",
  receipt: "reimb-receipt",
  accountName: "reimb-account-name",
  bsb: "reimb-bsb",
  accountNumber: "reimb-account-number",
} as const;

export const reimbursementBadge = {
  pending: "🟡 pending",
  submitted: "📨 submitted",
  paid: "✅ paid",
} as const;

// Admin list custom ids carry the active filter so paging, managing, and
// exporting all stay inside the same filtered view:
// `reimb-admin:<status|any>:<userId|all>:<action>[:<value>]`.
export function reimbursementAdminPrefix(filter: ReimbursementFilter): string {
  return `reimb-admin:${filter.status ?? "any"}:${filter.userId ?? "all"}`;
}

export type ReimbursementAdminAction =
  | "page"
  | "manage"
  | "submitted"
  | "paid"
  | "export"
  | "select";

export function parseReimbursementAdminId(
  customId: string,
):
  | { filter: ReimbursementFilter; action: ReimbursementAdminAction; value: number }
  | undefined {
  const match =
    /^reimb-admin:(any|pending|submitted|paid):(all|\d{17,20}):(page|manage|submitted|paid|export|select)(?::(\d+))?$/.exec(
      customId,
    );
  if (!match) return undefined;
  const [, status, userId, action, value] = match;
  if (!status || !userId || !action) return undefined;
  const filter: ReimbursementFilter = {
    ...(status === "any" ? {} : { status: status as ReimbursementStatus }),
    ...(userId === "all" ? {} : { userId }),
  };
  return {
    filter,
    action: action as ReimbursementAdminAction,
    value: Number(value ?? 0),
  };
}

export function buildReimbursementModal(current?: ReimbursementRecord): ModalBuilder {
  const eventName = new TextInputBuilder()
    .setCustomId(reimbursementIds.eventName)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Griffith AI-Hackathon 2026")
    .setMaxLength(100)
    .setRequired(true);
  if (current?.event_name) eventName.setValue(current.event_name);

  const description = new TextInputBuilder()
    .setCustomId(reimbursementIds.description)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Pizza and drinks for 30 attendees")
    .setMaxLength(200)
    .setRequired(false);
  if (current?.description) description.setValue(current.description);

  const amount = new TextInputBuilder()
    .setCustomId(reimbursementIds.amount)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("84.50")
    .setMaxLength(12)
    .setRequired(false);
  if (typeof current?.amount_cents === "number") {
    amount.setValue((current.amount_cents / 100).toFixed(2));
  }

  const receipt = new FileUploadBuilder()
    .setCustomId(reimbursementIds.receipt)
    .setMinValues(current ? 0 : 1)
    .setMaxValues(1)
    .setRequired(!current);

  return new ModalBuilder()
    .setCustomId(current ? `reimb:edit:${current.id}` : "reimb:create")
    .setTitle(current ? `Edit reimbursement #${current.id}` : "New reimbursement")
    .addLabelComponents(
      new LabelBuilder().setLabel("Event name").setTextInputComponent(eventName),
      new LabelBuilder()
        .setLabel("Short description (optional)")
        .setTextInputComponent(description),
      new LabelBuilder()
        .setLabel("Amount in AUD (optional)")
        .setDescription("How much you are owed, such as 84.50.")
        .setTextInputComponent(amount),
      new LabelBuilder()
        .setLabel(
          current ? "Receipt image (leave empty to keep current)" : "Receipt image",
        )
        .setDescription("Upload one photo or screenshot of the receipt.")
        .setFileUploadComponent(receipt),
    );
}

// `reimbursementId` is present when the modal was opened from a detail view
// button, so the submit handler can refresh that message's payout line.
export function buildPayoutModal(
  current: PayoutDetailsRecord | undefined,
  reimbursementId?: number,
): ModalBuilder {
  const accountName = new TextInputBuilder()
    .setCustomId(reimbursementIds.accountName)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Alex Smith")
    .setMaxLength(100)
    .setRequired(true);
  if (current?.account_name) accountName.setValue(current.account_name);

  const bsb = new TextInputBuilder()
    .setCustomId(reimbursementIds.bsb)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("064-000")
    .setMaxLength(8)
    .setRequired(true);
  if (current?.bsb) bsb.setValue(current.bsb);

  const accountNumber = new TextInputBuilder()
    .setCustomId(reimbursementIds.accountNumber)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("12345678")
    .setMaxLength(12)
    .setRequired(true);
  if (current?.account_number) accountNumber.setValue(current.account_number);

  return new ModalBuilder()
    .setCustomId(
      reimbursementId === undefined ? "reimb:payout" : `reimb:payout:${reimbursementId}`,
    )
    .setTitle("Payout details")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Account holder name")
        .setTextInputComponent(accountName),
      new LabelBuilder().setLabel("BSB").setTextInputComponent(bsb),
      new LabelBuilder().setLabel("Account number").setTextInputComponent(accountNumber),
    );
}

export function parseAmountCents(raw: string): number | undefined {
  const trimmed = raw.trim().replace(/^A?\$/i, "").replaceAll(",", "");
  if (!trimmed) return undefined;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error("Amount must be a dollar value such as 84.50.");
  }
  const cents = Math.round(Number(trimmed) * 100);
  if (cents <= 0) {
    throw new Error("Amount must be more than zero.");
  }
  return cents;
}

export function parseBsb(raw: string): string {
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(digits)) {
    throw new Error("BSB must be 6 digits, such as 064-000.");
  }
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

export function parseAccountNumber(raw: string): string {
  const digits = raw.replace(/\s/g, "");
  if (!/^\d{4,10}$/.test(digits)) {
    throw new Error("Account number must be 4-10 digits.");
  }
  return digits;
}

export function payoutSummary(payout: PayoutDetailsRecord | undefined): string {
  if (!payout) {
    return "⚠️ No payout details on file — use **Edit payout details** or `/reimbursement config`.";
  }
  return `💳 ${payout.account_name} · BSB ${payout.bsb} · Acct ${payout.account_number}`;
}

function amountLine(reimbursement: ReimbursementRecord): string {
  return typeof reimbursement.amount_cents === "number"
    ? formatCurrencyAmount(reimbursement.amount_cents, "aud")
    : "not specified";
}

function receiptLine(reimbursement: ReimbursementRecord): string {
  if (reimbursement.log_channel_id && reimbursement.log_message_id) {
    const link = `https://discord.com/channels/${reimbursement.guild_id}/${reimbursement.log_channel_id}/${reimbursement.log_message_id}`;
    return `[${reimbursement.receipt_name}](<${link}>)`;
  }
  return reimbursement.receipt_name;
}

export function reimbursementDetailLines(
  reimbursement: ReimbursementRecord,
  payout: PayoutDetailsRecord | undefined,
): string {
  const lines = [
    `🧾 **Reimbursement #${reimbursement.id}** — ${reimbursementBadge[reimbursement.status]}`,
    `Member: <@${reimbursement.user_id}>`,
    `Event: **${reimbursement.event_name}**`,
  ];
  if (reimbursement.description) lines.push(`Description: ${reimbursement.description}`);
  lines.push(`Amount: ${amountLine(reimbursement)}`);
  lines.push(`Receipt: ${receiptLine(reimbursement)}`);
  lines.push(payoutSummary(payout));
  lines.push(`Created <t:${Math.floor(reimbursement.created_at)}:R>`);
  if (reimbursement.submitted_at !== null) {
    lines.push(`Submitted <t:${Math.floor(reimbursement.submitted_at)}:R>`);
  }
  if (reimbursement.paid_at !== null) {
    lines.push(`Paid <t:${Math.floor(reimbursement.paid_at)}:R>`);
  }
  return lines.join("\n");
}

export function buildReimbursementDetail(
  reimbursement: ReimbursementRecord,
  payout: PayoutDetailsRecord | undefined,
): EventReplyOptions {
  return {
    content: reimbursementDetailLines(reimbursement, payout),
    embeds: [],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`reimb:edit-open:${reimbursement.id}`)
          .setLabel("Edit")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`reimb:payout-open:${reimbursement.id}`)
          .setLabel("Edit payout details")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

// The message posted to the reimbursement log channel; kept up to date as the
// reimbursement is edited and moves through pending → submitted → paid.
export function reimbursementLogContent(reimbursement: ReimbursementRecord): string {
  const lines = [
    `🧾 Reimbursement #${reimbursement.id} from <@${reimbursement.user_id}> — ${reimbursementBadge[reimbursement.status]}`,
    `Event: **${reimbursement.event_name}**`,
  ];
  if (reimbursement.description) lines.push(`Description: ${reimbursement.description}`);
  lines.push(`Amount: ${amountLine(reimbursement)}`);
  return lines.join("\n");
}

function filterLine(filter: ReimbursementFilter, viewerId: string): string {
  const parts = [];
  parts.push(
    filter.userId
      ? filter.userId === viewerId
        ? `your reimbursements`
        : `reimbursements from <@${filter.userId}>`
      : "all members",
  );
  if (filter.status) parts.push(reimbursementBadge[filter.status]);
  return `Showing ${parts.join(" · ")}`;
}

export function buildReimbursementList(
  reimbursements: ReimbursementRecord[],
  total: number,
  offset: number,
  filter: ReimbursementFilter,
  viewerId: string,
): EventReplyOptions {
  if (total === 0) {
    return {
      content: `No reimbursements found. ${filterLine(filter, viewerId)}.`,
      embeds: [],
      components: [],
    };
  }

  const prefix = reimbursementAdminPrefix(filter);
  const lines = reimbursements.map((reimbursement, index) => {
    const position = offset + index + 1;
    return (
      `${position}. #${reimbursement.id} <@${reimbursement.user_id}> — ` +
      `**${reimbursement.event_name}** · ${amountLine(reimbursement)} · ` +
      reimbursementBadge[reimbursement.status]
    );
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${prefix}:select`)
    .setPlaceholder("Manage a reimbursement…")
    .addOptions(
      reimbursements.map((reimbursement) => ({
        label: `#${reimbursement.id} · ${reimbursement.event_name}`.slice(0, 100),
        description: reimbursement.status,
        value: String(reimbursement.id),
      })),
    );

  const pager = buildPagerRow(prefix, offset, total, REIMBURSEMENT_LIST_PAGE_SIZE);
  pager.addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}:export:0`)
      .setLabel("📄 Export CSV")
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    content:
      `${pageHeading("Reimbursements", offset, total, REIMBURSEMENT_LIST_PAGE_SIZE)}\n` +
      `-# ${filterLine(filter, viewerId)}\n\n${lines.join("\n")}`,
    embeds: [],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      pager,
    ],
  };
}

export function buildReimbursementManage(
  reimbursement: ReimbursementRecord,
  payout: PayoutDetailsRecord | undefined,
  filter: ReimbursementFilter,
): EventReplyOptions {
  const prefix = reimbursementAdminPrefix(filter);
  return {
    content: reimbursementDetailLines(reimbursement, payout),
    embeds: [],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${prefix}:submitted:${reimbursement.id}`)
          .setLabel("Mark submitted")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(reimbursement.status !== "pending"),
        new ButtonBuilder()
          .setCustomId(`${prefix}:paid:${reimbursement.id}`)
          .setLabel("Mark paid")
          .setStyle(ButtonStyle.Success)
          .setDisabled(reimbursement.status !== "submitted"),
        new ButtonBuilder()
          .setCustomId(`${prefix}:page:0`)
          .setLabel("Back to list")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildReimbursementsCsv(
  reimbursements: ReimbursementRecord[],
  payoutsByUser: Map<string, PayoutDetailsRecord>,
): string {
  const header =
    "id,discord_user_id,event,description,amount,status," +
    "account_name,bsb,account_number,created_at,submitted_at,paid_at,receipt_filename";
  const rows = reimbursements.map((reimbursement) => {
    const payout = payoutsByUser.get(reimbursement.user_id);
    return [
      String(reimbursement.id),
      reimbursement.user_id,
      csvField(reimbursement.event_name),
      csvField(reimbursement.description),
      typeof reimbursement.amount_cents === "number"
        ? (reimbursement.amount_cents / 100).toFixed(2)
        : "",
      reimbursement.status,
      csvField(payout?.account_name ?? null),
      payout?.bsb ?? "",
      payout?.account_number ?? "",
      isoOrEmpty(reimbursement.created_at),
      isoOrEmpty(reimbursement.submitted_at),
      isoOrEmpty(reimbursement.paid_at),
      csvField(reimbursement.receipt_name),
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

function csvField(value: string | null): string {
  if (!value) return "";
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function isoOrEmpty(timestamp: number | null): string {
  return timestamp === null ? "" : new Date(timestamp * 1000).toISOString();
}
