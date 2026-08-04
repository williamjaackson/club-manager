import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

// Shared pager for admin list views (events, coupons, …). Buttons carry
// `<prefix>:page:<offset>` custom ids; the caller routes them back into its
// own list renderer.
export function buildPagerRow(
  prefix: string,
  offset: number,
  total: number,
  pageSize: number,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}:page:${Math.max(0, offset - pageSize)}`)
      .setLabel("◀ Newer")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(offset === 0),
    new ButtonBuilder()
      .setCustomId(`${prefix}:page:${offset + pageSize}`)
      .setLabel("Older ▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(offset + pageSize >= total),
  );
}

export function pageHeading(
  title: string,
  offset: number,
  total: number,
  pageSize: number,
): string {
  const page = Math.floor(offset / pageSize) + 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `**${title}** — newest first (page ${page}/${pages})`;
}
