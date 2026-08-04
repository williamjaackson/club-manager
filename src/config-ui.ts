import {
  ChannelSelectMenuBuilder,
  LabelBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  TextInputBuilder,
} from "@discordjs/builders";
import { ChannelType, TextInputStyle } from "discord.js";
import type { ResolvedGuildSettings } from "./settings.js";

export const configIds = {
  logChannel: "config-log-channel",
  connectedRole: "config-connected-role",
  exemptRole: "config-exempt-role",
  verificationUrl: "config-verification-url",
} as const;

export const configModalId = "config:settings";

export function buildConfigModal(current: ResolvedGuildSettings): ModalBuilder {
  const logChannel = new ChannelSelectMenuBuilder()
    .setCustomId(configIds.logChannel)
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1)
    .setMaxValues(1);
  if (current.rsvpLogChannelId) {
    logChannel.setDefaultChannels(current.rsvpLogChannelId);
  }

  const connectedRole = new RoleSelectMenuBuilder()
    .setCustomId(configIds.connectedRole)
    .setRequired(false)
    .setMinValues(0)
    .setMaxValues(1);
  if (current.connectedRoleId) {
    connectedRole.setDefaultRoles(current.connectedRoleId);
  }

  const exemptRole = new RoleSelectMenuBuilder()
    .setCustomId(configIds.exemptRole)
    .setRequired(false)
    .setMinValues(0)
    .setMaxValues(1);
  if (current.exemptRoleId) {
    exemptRole.setDefaultRoles(current.exemptRoleId);
  }

  const verificationUrl = new TextInputBuilder()
    .setCustomId(configIds.verificationUrl)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("https://discord.com/channels/…")
    .setMaxLength(300)
    .setRequired(false);
  if (current.verificationMessageUrl) {
    verificationUrl.setValue(current.verificationMessageUrl);
  }

  return new ModalBuilder()
    .setCustomId(configModalId)
    .setTitle("Club Manager settings")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("RSVP log channel")
        .setDescription("RSVPs, ticket purchases, and interest are logged here.")
        .setChannelSelectMenuComponent(logChannel),
      new LabelBuilder()
        .setLabel("Verified member role (optional)")
        .setDescription("Members need this role (or the exempt role) to respond.")
        .setRoleSelectMenuComponent(connectedRole),
      new LabelBuilder()
        .setLabel("Verification-exempt role (optional)")
        .setDescription("Members with this role skip verification.")
        .setRoleSelectMenuComponent(exemptRole),
      new LabelBuilder()
        .setLabel("Verification message link (optional)")
        .setDescription("Unverified members are pointed at this message.")
        .setTextInputComponent(verificationUrl),
    );
}

export function describeSettings(settings: ResolvedGuildSettings): string {
  const lines = [
    "✅ Settings saved.",
    "",
    `Log channel: ${settings.rsvpLogChannelId ? `<#${settings.rsvpLogChannelId}>` : "not set"}`,
    `Verified role: ${settings.connectedRoleId ? `<@&${settings.connectedRoleId}>` : "not set (verification disabled)"}`,
    `Exempt role: ${settings.exemptRoleId ? `<@&${settings.exemptRoleId}>` : "not set"}`,
    `Verification message: ${settings.verificationMessageUrl ?? "not set"}`,
  ];
  return lines.join("\n");
}
