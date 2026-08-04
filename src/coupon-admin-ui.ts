import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import type { CouponListRecord } from "./database.js";
import type { EventReplyOptions } from "./event-ui.js";
import { buildPagerRow, pageHeading } from "./pagination.js";
import { currentTimestamp } from "./time.js";

export const COUPON_LIST_PAGE_SIZE = 5;

export const couponAdminIds = {
  select: "coupon-admin:select",
} as const;

export function couponStatus(
  coupon: CouponListRecord,
  now = currentTimestamp(),
): "redeemed" | "expired" | "active" {
  if (coupon.redeemed_at !== null) return "redeemed";
  if (coupon.expires_at !== null && coupon.expires_at <= now) return "expired";
  return "active";
}

function couponScope(coupon: CouponListRecord): string {
  if (coupon.event_id === null) return "any paid event";
  return coupon.event_title ? `**${coupon.event_title}**` : "a deleted event";
}

const statusBadge = {
  active: "🟢 active",
  redeemed: "✅ redeemed",
  expired: "⌛ expired",
} as const;

export function buildCouponList(
  coupons: CouponListRecord[],
  total: number,
  offset: number,
): EventReplyOptions {
  if (total === 0) {
    return {
      content: "No coupons yet. Run `/coupon give` to create one.",
      embeds: [],
      components: [],
    };
  }

  const lines = coupons.map((coupon, index) => {
    const position = offset + index + 1;
    return (
      `${position}. <@${coupon.user_id}> — **${coupon.percent_off}% off** ` +
      `${couponScope(coupon)} · ${statusBadge[couponStatus(coupon)]}`
    );
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(couponAdminIds.select)
    .setPlaceholder("Manage a coupon…")
    .addOptions(
      coupons.map((coupon) => ({
        label: `#${coupon.id} · ${coupon.percent_off}% off`,
        description: couponStatus(coupon),
        value: String(coupon.id),
      })),
    );

  return {
    content: `${pageHeading("Coupons", offset, total, COUPON_LIST_PAGE_SIZE)}\n\n${lines.join("\n")}`,
    embeds: [],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      buildPagerRow("coupon-admin", offset, total, COUPON_LIST_PAGE_SIZE),
    ],
  };
}

export function buildCouponManageView(coupon: CouponListRecord): EventReplyOptions {
  const status = couponStatus(coupon);
  const lines = [
    `**Coupon #${coupon.id}** — ${statusBadge[status]}`,
    `Member: <@${coupon.user_id}>`,
    `Discount: **${coupon.percent_off}% off** ${couponScope(coupon)}`,
    `Issued by <@${coupon.created_by}> <t:${Math.floor(coupon.created_at)}:R>`,
  ];
  if (coupon.expires_at !== null) {
    lines.push(`Expires: <t:${Math.floor(coupon.expires_at)}:F>`);
  }
  if (coupon.redeemed_at !== null) {
    lines.push(`Redeemed <t:${Math.floor(coupon.redeemed_at)}:R>`);
  }

  return {
    content: lines.join("\n"),
    embeds: [],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`coupon-admin:revoke:${coupon.id}`)
          .setLabel("Revoke coupon")
          .setStyle(ButtonStyle.Danger)
          .setDisabled(status === "redeemed"),
        new ButtonBuilder()
          .setCustomId("coupon-admin:page:0")
          .setLabel("Back to list")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}
