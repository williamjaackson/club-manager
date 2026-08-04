import type { Store } from "./database.js";
import { currentTimestamp } from "./time.js";

export interface ResolvedGuildSettings {
  rsvpLogChannelId?: string;
  verificationMessageUrl?: string;
  connectedRoleId?: string;
  exemptRoleId?: string;
  reimbursementLogChannelId?: string;
}

export interface SettingsResolver {
  resolve(guildId: string): Promise<ResolvedGuildSettings>;
}

export interface SettingsManager extends SettingsResolver {
  update(guildId: string, update: GuildSettingsInput): Promise<ResolvedGuildSettings>;
}

export interface GuildSettingsInput {
  rsvpLogChannelId?: string;
  verificationMessageUrl?: string;
  connectedRoleId?: string;
  exemptRoleId?: string;
  reimbursementLogChannelId?: string;
}

const CACHE_TTL_SECONDS = 60;

// Per-guild settings live in guild_settings and are managed with /config.
// Environment variables act only as fallbacks so existing deployments keep
// working until /config is run once.
export class GuildSettingsService implements SettingsManager {
  readonly #store: Store;
  readonly #envDefaults: ResolvedGuildSettings;
  readonly #cache = new Map<
    string,
    { value: ResolvedGuildSettings; fetchedAt: number }
  >();

  constructor(store: Store, envDefaults: ResolvedGuildSettings = {}) {
    this.#store = store;
    this.#envDefaults = envDefaults;
  }

  async resolve(guildId: string): Promise<ResolvedGuildSettings> {
    const cached = this.#cache.get(guildId);
    if (cached && cached.fetchedAt + CACHE_TTL_SECONDS > currentTimestamp()) {
      return cached.value;
    }

    const record = await this.#store.getGuildSettings(guildId);
    const value: ResolvedGuildSettings = {};
    const rsvpLogChannelId =
      record?.rsvp_log_channel_id ?? this.#envDefaults.rsvpLogChannelId;
    const verificationMessageUrl =
      record?.verification_message_url ?? this.#envDefaults.verificationMessageUrl;
    const connectedRoleId =
      record?.connected_role_id ?? this.#envDefaults.connectedRoleId;
    const exemptRoleId = record?.exempt_role_id ?? this.#envDefaults.exemptRoleId;
    const reimbursementLogChannelId =
      record?.reimbursement_log_channel_id ?? this.#envDefaults.reimbursementLogChannelId;

    if (rsvpLogChannelId) value.rsvpLogChannelId = rsvpLogChannelId;
    if (verificationMessageUrl) value.verificationMessageUrl = verificationMessageUrl;
    if (connectedRoleId) value.connectedRoleId = connectedRoleId;
    if (exemptRoleId) value.exemptRoleId = exemptRoleId;
    if (reimbursementLogChannelId) {
      value.reimbursementLogChannelId = reimbursementLogChannelId;
    }

    this.#cache.set(guildId, { value, fetchedAt: currentTimestamp() });
    return value;
  }

  // The /config modal submits complete state, so an omitted field clears the
  // stored value (env fallbacks still apply on resolve).
  async update(
    guildId: string,
    update: GuildSettingsInput,
  ): Promise<ResolvedGuildSettings> {
    await this.#store.upsertGuildSettings(guildId, update);
    this.#cache.delete(guildId);
    return this.resolve(guildId);
  }
}
