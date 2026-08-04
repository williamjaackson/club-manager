import assert from "node:assert/strict";
import test from "node:test";
import { buildConfigModal } from "../dist/config-ui.js";

test("marks optional role selects as not required so Discord accepts the modal", () => {
  const modal = buildConfigModal({}).toJSON();
  const [logChannel, connectedRole, exemptRole, verificationUrl] = modal.components.map(
    ({ component }) => component,
  );

  // Required components cannot carry min_values of 0 (COMPONENT_REQUIRED_ZERO_MIN_VALUES).
  assert.equal(connectedRole.required, false);
  assert.equal(connectedRole.min_values, 0);
  assert.equal(exemptRole.required, false);
  assert.equal(exemptRole.min_values, 0);

  assert.notEqual(logChannel.required, false);
  assert.equal(verificationUrl.required, false);
});
