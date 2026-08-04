import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCouponList,
  buildCouponManageView,
  couponStatus,
} from "../dist/coupon-admin-ui.js";

function coupon(overrides = {}) {
  return {
    id: 7,
    guild_id: "12345678901234567",
    user_id: "52345678901234567",
    percent_off: 25,
    event_id: null,
    event_title: null,
    created_by: "32345678901234567",
    created_at: 100,
    expires_at: null,
    redeemed_order_id: null,
    redeemed_at: null,
    ...overrides,
  };
}

test("derives coupon status from redemption and expiry", () => {
  assert.equal(couponStatus(coupon(), 500), "active");
  assert.equal(couponStatus(coupon({ expires_at: 400 }), 500), "expired");
  assert.equal(
    couponStatus(coupon({ redeemed_at: 300, expires_at: 400 }), 500),
    "redeemed",
  );
});

test("paginates the coupon list with the shared pager", () => {
  const coupons = Array.from({ length: 5 }, (_, index) => coupon({ id: 20 - index }));
  const list = buildCouponList(coupons, 12, 5);

  assert.match(list.content ?? "", /page 2\/3/);
  const pager = list.components?.[1]?.components.map((b) => b.toJSON());
  assert.equal(pager?.[0]?.custom_id, "coupon-admin:page:0");
  assert.equal(pager?.[0]?.disabled, false);
  assert.equal(pager?.[1]?.custom_id, "coupon-admin:page:10");
  assert.equal(pager?.[1]?.disabled, false);
});

test("manage view blocks revoking redeemed coupons", () => {
  const active = buildCouponManageView(coupon());
  const redeemed = buildCouponManageView(coupon({ redeemed_at: 300 }));

  assert.equal(active.components?.[0]?.components[0]?.toJSON().disabled, false);
  assert.equal(redeemed.components?.[0]?.components[0]?.toJSON().disabled, true);
});
