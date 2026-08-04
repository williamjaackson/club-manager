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

function ticketPaidRecord(overrides = {}) {
  return {
    id: 8,
    event_id: 42,
    user_id: "52345678901234567",
    action: "ticket_paid",
    title: "Paid event",
    guild_id: "12345678901234567",
    announcement_channel_id: "22345678901234567",
    message_id: "32345678901234567",
    test_mode: false,
    ...overrides,
  };
}

test("posts ticket purchases and DMs the buyer", async () => {
  let sent;
  let dm;
  let markedId;
  const record = ticketPaidRecord({ test_mode: true });
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
      users: {
        async fetch() {
          return {
            async send(content) { dm = content; },
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
  assert.match(sent.content, /bought a ticket for/);
  assert.match(dm, /test ticket for \*\*Paid event\*\* is confirmed/);
  assert.match(dm, new RegExp(record.message_id));
});

test("marks the audit sent even when the confirmation DM fails", async () => {
  let sent;
  let markedId;
  const record = ticketPaidRecord();
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
      users: {
        async fetch() {
          throw new Error("Cannot send messages to this user");
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
  assert.match(sent.content, /bought a ticket for/);
});

test("flush never rejects even when the store fails", async () => {
  const logger = new AuditLogger(
    { channels: { async fetch() { throw new Error("unreachable"); } } },
    {
      async getPendingAudit() {
        throw new Error("database is down");
      },
    },
    "42345678901234567",
  );

  await assert.doesNotReject(logger.flush());
});
