import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationCommandType, PermissionFlagsBits } from "discord.js";
import { commandDefinitions } from "../dist/commands.js";

test("registers Close Event as an administrator message command", () => {
  const command = commandDefinitions.find(({ name }) => name === "Close Event");

  assert.equal(command?.type, ApplicationCommandType.Message);
  assert.equal(
    command?.default_member_permissions,
    PermissionFlagsBits.Administrator.toString(),
  );
});
