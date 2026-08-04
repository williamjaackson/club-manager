import type Stripe from "stripe";
import type {
  EventRecord,
  PriceDropRefund,
  Store,
  TicketOrderRecord,
} from "./database.js";
import { formatCurrencyAmount } from "./money.js";
import { currentTimestamp } from "./time.js";

export interface CheckoutDiscount {
  percentOff: number;
  discountedCents: number;
}

export type TicketCheckoutResult =
  | { alreadyPaid: true; order: TicketOrderRecord }
  | {
      alreadyPaid: false;
      order: TicketOrderRecord;
      checkoutUrl: string;
      discount?: CheckoutDiscount;
    };

// Stripe cannot charge less than A$0.50; below that a coupon makes the
// ticket free and Stripe is bypassed entirely.
const STRIPE_MINIMUM_CENTS = 50;

export function discountedPriceCents(priceCents: number, percentOff: number): number {
  return Math.round((priceCents * (100 - percentOff)) / 100);
}

export class InvalidStripeWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStripeWebhookError";
  }
}

type StripeWebhookMode = "primary" | "test";

interface StripeTestMode {
  stripe: Stripe;
  webhookSecret: string;
}

export class TicketingService {
  readonly #stripe: Stripe;
  readonly #store: Store;
  readonly #publicBaseUrl: string;
  readonly #webhookSecret: string;
  readonly #testMode: StripeTestMode | undefined;
  readonly #onOrderChange: (eventId: number) => void;

  constructor(
    stripe: Stripe,
    store: Store,
    publicBaseUrl: string,
    webhookSecret: string,
    testMode?: StripeTestMode,
    onOrderChange: (eventId: number) => void = () => {},
  ) {
    this.#stripe = stripe;
    this.#store = store;
    this.#publicBaseUrl = publicBaseUrl;
    this.#webhookSecret = webhookSecret;
    this.#testMode = testMode;
    this.#onOrderChange = onOrderChange;
  }

  async startCheckout(
    event: EventRecord,
    userId: string,
    options: { applyCoupon?: boolean } = {},
  ): Promise<TicketCheckoutResult> {
    const applyCoupon = options.applyCoupon ?? true;
    const stripe = this.#stripeForEvent(event);
    const reservation = await this.#store.reserveTicketCheckout(event.id, userId);

    if (reservation.alreadyPaid) {
      return { alreadyPaid: true, order: reservation.order };
    }

    if (
      reservation.order.checkout_url &&
      reservation.order.checkout_expires_at > currentTimestamp()
    ) {
      return {
        alreadyPaid: false,
        order: reservation.order,
        checkoutUrl: reservation.order.checkout_url,
      };
    }

    if (reservation.order.checkout_expires_at <= currentTimestamp()) {
      throw new Error(
        "Your previous checkout just expired. To make sure you aren’t " +
          "double-charged, you can retry in about 5 minutes.",
      );
    }

    if (!event.ticket_price_cents || !event.ticket_currency) {
      throw new Error("This event does not have paid tickets.");
    }

    const order = reservation.order;
    const coupon = applyCoupon
      ? await this.#store.findBestCoupon(event.guild_id, userId, event.id)
      : undefined;
    const chargeCents = coupon
      ? discountedPriceCents(event.ticket_price_cents, coupon.percent_off)
      : event.ticket_price_cents;

    if (coupon && chargeCents < STRIPE_MINIMUM_CENTS) {
      const paid = await this.#store.fulfillCouponFreeOrder(order.id, coupon.id);
      this.#onOrderChange(event.id);
      return { alreadyPaid: true, order: paid };
    }

    const metadata = {
      ticket_order_id: String(order.id),
      event_id: String(event.id),
      discord_user_id: userId,
      test_event: String(event.test_mode === true),
      ...(coupon
        ? {
            coupon_id: String(coupon.id),
            coupon_percent_off: String(coupon.percent_off),
          }
        : {}),
    };
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: `${event.id}:${userId}`,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: event.ticket_currency,
              unit_amount: chargeCents,
              product_data: {
                name: event.title,
                description: `${event.schedule_text} — ${event.location}`.slice(0, 500),
              },
            },
          },
        ],
        metadata,
        payment_intent_data: { metadata },
        customer_creation: "always",
        success_url: `${this.#publicBaseUrl}/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${this.#publicBaseUrl}/stripe/cancel`,
        expires_at: Math.floor(order.checkout_expires_at),
      },
      { idempotencyKey: `ticket-order-${order.id}-attempt-${order.attempt}` },
    );

    if (!session.url) {
      throw new Error("Stripe did not return a Checkout URL.");
    }

    const attached = await this.#store.attachTicketCheckout(
      order.id,
      order.attempt,
      session.id,
      session.url,
    );
    return {
      alreadyPaid: false,
      order: attached,
      checkoutUrl: session.url,
      ...(coupon
        ? {
            discount: {
              percentOff: coupon.percent_off,
              discountedCents: chargeCents,
            },
          }
        : {}),
    };
  }

  // Refunds the price difference after an admin lowers a paid event's price.
  // Failures are logged and reported; unfinalized orders keep amount_total
  // above the new price, so the next saved edit retries them automatically.
  async refundPriceDifferences(
    event: EventRecord,
    refunds: PriceDropRefund[],
  ): Promise<{ refunded: number; failed: number }> {
    const stripe = this.#stripeForEvent(event);
    let refunded = 0;
    let failed = 0;

    for (const refund of refunds) {
      if (!refund.paymentIntentId) {
        failed += 1;
        console.warn(
          `Ticket order ${refund.orderId} has no payment intent; ` +
            "refund the difference manually in the Stripe dashboard",
        );
        continue;
      }

      try {
        await stripe.refunds.create(
          {
            payment_intent: refund.paymentIntentId,
            amount: refund.amountCents,
          },
          {
            idempotencyKey: `price-drop-${refund.orderId}-${refund.newAmountTotal}`,
          },
        );
        await this.#store.finalizePriceAdjustment(
          refund.orderId,
          refund.newAmountTotal,
          `${formatCurrencyAmount(
            refund.amountCents,
            event.ticket_currency ?? "aud",
          )} is being refunded to your card.`,
        );
        refunded += 1;
      } catch (error) {
        failed += 1;
        console.error(
          `Failed to refund the price difference for order ${refund.orderId}`,
          error,
        );
      }
    }

    return { refunded, failed };
  }

  // Fully refunds every paid order of a cancelled event. Revocation and the
  // member's refund DM arrive through the charge.refunded webhook.
  async refundCancelledEventOrders(
    event: EventRecord,
    orders: { orderId: number; paymentIntentId: string | null }[],
  ): Promise<{ refunded: number; failed: number }> {
    const stripe = this.#stripeForEvent(event);
    let refunded = 0;
    let failed = 0;

    for (const order of orders) {
      if (!order.paymentIntentId) {
        failed += 1;
        console.warn(
          `Ticket order ${order.orderId} has no payment intent; refund manually`,
        );
        continue;
      }
      try {
        await stripe.refunds.create(
          { payment_intent: order.paymentIntentId },
          { idempotencyKey: `event-cancel-${order.orderId}` },
        );
        refunded += 1;
      } catch (error) {
        failed += 1;
        console.error(`Failed to refund cancelled order ${order.orderId}`, error);
      }
    }

    return { refunded, failed };
  }

  async handleWebhook(
    payload: Buffer,
    signature: string,
    mode: StripeWebhookMode = "primary",
  ): Promise<void> {
    let event: Stripe.Event;
    const webhook = this.#webhookForMode(mode);

    try {
      event = webhook.stripe.webhooks.constructEvent(payload, signature, webhook.secret);
    } catch (error) {
      throw new InvalidStripeWebhookError(
        error instanceof Error ? error.message : "Invalid Stripe signature",
      );
    }

    if (event.type === "charge.refunded") {
      const charge = await webhook.stripe.charges.retrieve(event.data.object.id);
      await this.#revokeFullyRefundedCharge(charge, mode === "test");
      return;
    }

    if (
      event.type !== "checkout.session.completed" &&
      event.type !== "checkout.session.async_payment_succeeded"
    ) {
      return;
    }

    const checkout = await webhook.stripe.checkout.sessions.retrieve(
      event.data.object.id,
      { expand: ["line_items"] },
    );

    if (checkout.payment_status !== "paid") return;

    await this.#fulfillCheckout(checkout, mode === "test");
  }

  async checkoutStatus(
    checkoutSessionId: string,
  ): Promise<"paid" | "pending" | "refunded" | "unknown"> {
    const order = await this.#store.getTicketOrderByCheckoutSession(checkoutSessionId);
    return order?.status ?? "unknown";
  }

  async #revokeFullyRefundedCharge(
    charge: Stripe.Charge,
    testMode: boolean,
  ): Promise<void> {
    if (!charge.refunded || charge.amount_refunded < charge.amount) return;

    const paymentIntentId =
      typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id;
    if (!paymentIntentId) return;

    const successfulRefund = charge.refunds?.data.find(
      (refund) => refund.status === "succeeded",
    );
    const details: Parameters<Store["refundTicketOrderByPaymentIntent"]>[1] = {
      chargeId: charge.id,
      testMode,
    };
    if (successfulRefund) details.refundId = successfulRefund.id;

    const revoked = await this.#store.refundTicketOrderByPaymentIntent(
      paymentIntentId,
      details,
    );

    if (revoked !== undefined) this.#onOrderChange(revoked);
    if (revoked === undefined) {
      console.warn(
        `Stripe refund for charge ${charge.id} (payment intent ` +
          `${paymentIntentId}, testMode=${testMode}) matched no paid ticket order`,
      );
    }
  }

  async #fulfillCheckout(
    checkout: Stripe.Checkout.Session,
    testMode: boolean,
  ): Promise<void> {
    if (
      checkout.mode !== "payment" ||
      checkout.line_items?.data.length !== 1 ||
      checkout.line_items.data[0]?.quantity !== 1
    ) {
      throw new Error("Checkout Session does not contain one ticket.");
    }

    const orderId = integerMetadata(checkout.metadata?.ticket_order_id);
    const eventId = integerMetadata(checkout.metadata?.event_id);
    const userId = checkout.metadata?.discord_user_id;

    if (!orderId || !eventId || !userId) {
      throw new Error("Checkout Session is missing ticket metadata.");
    }

    const [order, event] = await Promise.all([
      this.#store.getTicketOrder(orderId),
      this.#store.getEvent(eventId),
    ]);

    if (!order || !event) {
      throw new Error("Checkout Session references an unknown ticket order.");
    }

    if (order.event_id !== event.id || order.user_id !== userId) {
      throw new Error("Checkout Session ticket metadata does not match the order.");
    }

    if ((event.test_mode === true) !== testMode || (testMode && checkout.livemode)) {
      throw new Error("Checkout Session mode does not match the ticket event.");
    }

    const couponId = integerMetadata(checkout.metadata?.coupon_id);
    const couponPercentOff = integerMetadata(checkout.metadata?.coupon_percent_off);
    const expectedTotal =
      couponPercentOff !== undefined && event.ticket_price_cents !== null
        ? discountedPriceCents(event.ticket_price_cents, couponPercentOff)
        : event.ticket_price_cents;

    if (
      checkout.amount_total === null ||
      checkout.currency === null ||
      checkout.amount_total !== expectedTotal ||
      checkout.currency !== event.ticket_currency
    ) {
      throw new Error("Checkout Session total does not match the ticket price.");
    }

    const paymentIntentId =
      typeof checkout.payment_intent === "string"
        ? checkout.payment_intent
        : checkout.payment_intent?.id;
    const details: Parameters<Store["fulfillTicketOrder"]>[2] = {
      amountTotal: checkout.amount_total,
      currency: checkout.currency,
    };

    if (paymentIntentId) details.paymentIntentId = paymentIntentId;
    if (checkout.customer_details?.email) {
      details.customerEmail = checkout.customer_details.email;
    }
    if (checkout.customer_details?.name) {
      details.customerName = checkout.customer_details.name;
    }

    if (couponId !== undefined) details.couponId = couponId;

    await this.#store.fulfillTicketOrder(order.id, checkout.id, details);
    this.#onOrderChange(event.id);
  }

  #stripeForEvent(event: EventRecord): Stripe {
    if (!event.test_mode) return this.#stripe;
    if (!this.#testMode) {
      throw new Error(
        "Stripe test mode requires STRIPE_TEST_SECRET_KEY and STRIPE_TEST_WEBHOOK_SECRET.",
      );
    }
    return this.#testMode.stripe;
  }

  #webhookForMode(mode: StripeWebhookMode): {
    stripe: Stripe;
    secret: string;
  } {
    if (mode === "primary") {
      return { stripe: this.#stripe, secret: this.#webhookSecret };
    }
    if (!this.#testMode) {
      throw new InvalidStripeWebhookError("Stripe test mode is not configured.");
    }
    return {
      stripe: this.#testMode.stripe,
      secret: this.#testMode.webhookSecret,
    };
  }
}

function integerMetadata(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
