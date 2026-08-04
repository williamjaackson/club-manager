import assert from "node:assert/strict";
import test from "node:test";
import { AuditLogger } from "../dist/audit.js";

test("logs ticket interest to the audit channel", async () => {
  let sent;
  let markedId;
  const record = {
    id: 7,
    event_id: 42,
    user_id: "52345678901234567",
    action: "interest_ticket",
    title: "Paid event",
    guild_id: "12345678901234567",
    announcement_channel_id: "22345678901234567",
    message_id: "32345678901234567",
  };
  const logger = new AuditLogger(
    {
      channels: {
        async fetch() {
          return {
            isSendable() { return true; },
            async send(options) { sent = options; },
          };
        },
      },
    },
    {
      async getPendingAudit() { return [record]; },
      async markAuditSent(id) { markedId = id; },
    },
    "42345678901234567",
  );

  await logger.flush();

  assert.equal(markedId, record.id);
  assert.match(sent.content, /showed ticket interest in/);
  assert.match(sent.content, new RegExp(record.message_id));
});
