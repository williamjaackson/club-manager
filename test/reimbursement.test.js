import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { Store, setupDatabase } from "../dist/database.js";
import {
  buildPayoutModal,
  buildReimbursementList,
  buildReimbursementModal,
  buildReimbursementsCsv,
  parseAccountNumber,
  parseAmountCents,
  parseBsb,
  parseReimbursementAdminId,
  reimbursementAdminPrefix,
} from "../dist/reimbursement-ui.js";

const GUILD = "12345678901234567";
const ALICE = "22345678901234567";
const BOB = "32345678901234567";

async function fixture() {
  const memory = newDb();
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  await setupDatabase(pool);
  const store = new Store(pool);
  return {
    store,
    async close() {
      await store.close();
    },
  };
}

function newReimbursement(store, overrides = {}, now = 100) {
  return store.createReimbursement(
    {
      guildId: GUILD,
      userId: ALICE,
      eventName: "Hackathon",
      receiptUrl: "https://cdn.example/receipt.png",
      receiptName: "receipt.png",
      ...overrides,
    },
    now,
  );
}

test("creates a pending reimbursement and only advances forward", async () => {
  const context = await fixture();
  try {
    const created = await newReimbursement(context.store);
    assert.equal(created.status, "pending");
    assert.equal(created.amount_cents, null);

    // paid before submitted is rejected
    assert.equal(
      await context.store.advanceReimbursementStatus(created.id, GUILD, "paid", 200),
      undefined,
    );

    const submitted = await context.store.advanceReimbursementStatus(
      created.id,
      GUILD,
      "submitted",
      200,
    );
    assert.equal(submitted?.status, "submitted");
    assert.equal(submitted?.submitted_at, 200);

    // repeat submission is rejected
    assert.equal(
      await context.store.advanceReimbursementStatus(created.id, GUILD, "submitted", 250),
      undefined,
    );

    const paid = await context.store.advanceReimbursementStatus(
      created.id,
      GUILD,
      "paid",
      300,
    );
    assert.equal(paid?.status, "paid");
    assert.equal(paid?.paid_at, 300);
  } finally {
    await context.close();
  }
});

test("filters and paginates reimbursement lists", async () => {
  const context = await fixture();
  try {
    const first = await newReimbursement(context.store, {}, 100);
    await newReimbursement(context.store, { userId: BOB, eventName: "BBQ" }, 200);
    await newReimbursement(context.store, { eventName: "Games night" }, 300);
    await context.store.advanceReimbursementStatus(first.id, GUILD, "submitted", 400);

    const all = await context.store.listReimbursements(GUILD, {}, 0, 2);
    assert.equal(all.total, 3);
    assert.equal(all.reimbursements.length, 2);
    // newest first
    assert.equal(all.reimbursements[0].event_name, "Games night");

    const alicesPending = await context.store.listReimbursements(
      GUILD,
      { userId: ALICE, status: "pending" },
      0,
      10,
    );
    assert.equal(alicesPending.total, 1);
    assert.equal(alicesPending.reimbursements[0].event_name, "Games night");

    const submitted = await context.store.listAllReimbursements(GUILD, {
      status: "submitted",
    });
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].id, first.id);
  } finally {
    await context.close();
  }
});

test("keeps the stored receipt unless a replacement is uploaded", async () => {
  const context = await fixture();
  try {
    const created = await newReimbursement(context.store, { amountCents: 5000 });

    const edited = await context.store.updateReimbursementDetails(
      created.id,
      GUILD,
      { eventName: "Hackathon 2026", description: "Pizza", amountCents: null },
      200,
    );
    assert.equal(edited?.event_name, "Hackathon 2026");
    assert.equal(edited?.amount_cents, null);
    assert.equal(edited?.receipt_url, "https://cdn.example/receipt.png");

    const replaced = await context.store.updateReimbursementDetails(
      created.id,
      GUILD,
      {
        eventName: "Hackathon 2026",
        description: "Pizza",
        amountCents: 4200,
        receipt: {
          url: "https://cdn.example/new.png",
          name: "new.png",
          logChannelId: "42345678901234567",
          logMessageId: "52345678901234567",
        },
      },
      300,
    );
    assert.equal(replaced?.receipt_url, "https://cdn.example/new.png");
    assert.equal(replaced?.log_message_id, "52345678901234567");
    assert.equal(replaced?.amount_cents, 4200);
  } finally {
    await context.close();
  }
});

test("upserts payout details per member", async () => {
  const context = await fixture();
  try {
    await context.store.upsertPayoutDetails(
      GUILD,
      ALICE,
      { accountName: "Alice A", bsb: "064-000", accountNumber: "12345678" },
      100,
    );
    const updated = await context.store.upsertPayoutDetails(
      GUILD,
      ALICE,
      { accountName: "Alice A", bsb: "064-999", accountNumber: "87654321" },
      200,
    );
    assert.equal(updated.bsb, "064-999");

    const fetched = await context.store.getPayoutDetails(GUILD, ALICE);
    assert.equal(fetched?.account_number, "87654321");
    assert.equal(await context.store.getPayoutDetails(GUILD, BOB), undefined);
  } finally {
    await context.close();
  }
});

test("stores the reimbursement log channel in guild settings", async () => {
  const context = await fixture();
  try {
    const saved = await context.store.upsertGuildSettings(GUILD, {
      rsvpLogChannelId: "42345678901234567",
      reimbursementLogChannelId: "52345678901234567",
    });
    assert.equal(saved.reimbursement_log_channel_id, "52345678901234567");
  } finally {
    await context.close();
  }
});

test("requires the receipt upload on create but not on edit", () => {
  const create = buildReimbursementModal().toJSON();
  const createUpload = create.components.at(-1).component;
  assert.equal(createUpload.required, true);
  assert.equal(createUpload.min_values, 1);

  const edit = buildReimbursementModal({
    id: 7,
    guild_id: GUILD,
    user_id: ALICE,
    event_name: "Hackathon",
    description: "Pizza",
    amount_cents: 8450,
    receipt_url: "https://cdn.example/receipt.png",
    receipt_name: "receipt.png",
    log_channel_id: null,
    log_message_id: null,
    status: "pending",
    created_at: 100,
    updated_at: 100,
    submitted_at: null,
    paid_at: null,
  }).toJSON();
  assert.equal(edit.custom_id, "reimb:edit:7");
  const editUpload = edit.components.at(-1).component;
  assert.equal(editUpload.required, false);
  assert.equal(editUpload.min_values, 0);
  // prefills text fields
  assert.equal(edit.components[0].component.value, "Hackathon");
  assert.equal(edit.components[2].component.value, "84.50");
});

test("payout modal carries the reimbursement id only when opened from a detail view", () => {
  assert.equal(buildPayoutModal(undefined).toJSON().custom_id, "reimb:payout");
  assert.equal(buildPayoutModal(undefined, 12).toJSON().custom_id, "reimb:payout:12");
});

test("parses amounts, BSBs, and account numbers", () => {
  assert.equal(parseAmountCents("84.50"), 8450);
  assert.equal(parseAmountCents("$1,200"), 120000);
  assert.equal(parseAmountCents("A$9.99"), 999);
  assert.equal(parseAmountCents("  "), undefined);
  assert.throws(() => parseAmountCents("12.345"));
  assert.throws(() => parseAmountCents("free"));
  assert.throws(() => parseAmountCents("0"));

  assert.equal(parseBsb("064-000"), "064-000");
  assert.equal(parseBsb("064 000"), "064-000");
  assert.equal(parseBsb("064000"), "064-000");
  assert.throws(() => parseBsb("64-000"));

  assert.equal(parseAccountNumber("12 345 678"), "12345678");
  assert.throws(() => parseAccountNumber("123"));
  assert.throws(() => parseAccountNumber("not-a-number"));
});

test("round-trips admin custom ids with their filter", () => {
  const filter = { status: "pending", userId: ALICE };
  const prefix = reimbursementAdminPrefix(filter);
  const parsed = parseReimbursementAdminId(`${prefix}:page:10`);
  assert.deepEqual(parsed, { filter, action: "page", value: 10 });

  const unfiltered = parseReimbursementAdminId("reimb-admin:any:all:export:0");
  assert.deepEqual(unfiltered, { filter: {}, action: "export", value: 0 });

  assert.equal(parseReimbursementAdminId("coupon-admin:page:0"), undefined);
  assert.equal(parseReimbursementAdminId("reimb-admin:bogus:all:page:0"), undefined);
});

function listRecord(overrides = {}) {
  return {
    id: 1,
    guild_id: GUILD,
    user_id: ALICE,
    event_name: "Hackathon",
    description: null,
    amount_cents: 8450,
    receipt_url: "https://cdn.example/receipt.png",
    receipt_name: "receipt.png",
    log_channel_id: null,
    log_message_id: null,
    status: "pending",
    created_at: 100,
    updated_at: 100,
    submitted_at: null,
    paid_at: null,
    ...overrides,
  };
}

test("list view keeps paging and exporting inside the active filter", () => {
  const filter = { status: "pending" };
  const view = buildReimbursementList([listRecord()], 6, 0, filter, BOB);
  assert.match(view.content, /Reimbursements/);
  assert.match(view.content, /pending/);

  const [selectRow, buttonRow] = view.components.map((row) => row.toJSON());
  assert.equal(selectRow.components[0].custom_id, "reimb-admin:pending:all:select");
  const customIds = buttonRow.components.map((button) => button.custom_id);
  assert.deepEqual(customIds, [
    "reimb-admin:pending:all:page:0",
    "reimb-admin:pending:all:page:5",
    "reimb-admin:pending:all:export:0",
  ]);
});

test("builds a CSV row with payout details and receipt filename", () => {
  const csv = buildReimbursementsCsv(
    [listRecord({ description: 'Pizza, "extra cheese"' })],
    new Map([
      [
        ALICE,
        {
          guild_id: GUILD,
          user_id: ALICE,
          account_name: "Alice A",
          bsb: "064-000",
          account_number: "12345678",
          updated_at: 100,
        },
      ],
    ]),
  );
  const [header, row] = csv.split("\n");
  assert.match(header, /^id,discord_user_id,event,description,amount,status/);
  assert.equal(
    row,
    `1,${ALICE},Hackathon,"Pizza, ""extra cheese""",84.50,pending,` +
      "Alice A,064-000,12345678,1970-01-01T00:01:40.000Z,,,receipt.png",
  );
});
