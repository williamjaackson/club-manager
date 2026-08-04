import Stripe from "stripe";
import {
  type EventRecord,
  type Store,
  type TicketOrderRecord,
} from "./database.js";

export type TicketCheckoutResult =
  | { alreadyPaid: true; order: TicketOrderRecord }
  | {
      alreadyPaid: false;
      order: TicketOrderRecord;
      checkoutUrl: string;
    };

export class InvalidStripeWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStripeWebhookError";
  }
}

export class TicketingService {
  readonly #stripe: Stripe;
  readonly #store: Store;
  readonly #publicBaseUrl: string;
  readonly #webhookSecret: string;

  constructor(
    stripe: Stripe,
    store: Store,
    publicBaseUrl: string,
    webhookSecret: string,
  ) {
    this.#stripe = stripe;
    this.#store = store;
    this.#publicBaseUrl = publicBaseUrl;
    this.#webhookSecret = webhookSecret;
  }

  async startCheckout(
    event: EventRecord,
    userId: string,
  ): Promise<TicketCheckoutResult> {
    const reservation = await this.#store.reserveTicketCheckout(
      event.id,
      userId,
    );

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
        "That Checkout Session has expired. Try again in a few minutes.",
      );
    }

    if (!event.ticket_price_cents || !event.ticket_currency) {
      throw new Error("This event does not have paid tickets.");
    }

    const order = reservation.order;
    const metadata = {
      ticket_order_id: String(order.id),
      event_id: String(event.id),
      discord_user_id: userId,
    };
    const session = await this.#stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: `${event.id}:${userId}`,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: event.ticket_currency,
              unit_amount: event.ticket_price_cents,
              product_data: {
                name: event.title,
                description: `${event.schedule_text} — ${event.location}`.slice(
                  0,
                  500,
                ),
              },
            },
          },
        ],
        metadata,
        payment_intent_data: { metadata },
        customer_creation: "always",
        success_url:
          `${this.#publicBaseUrl}/stripe/success?session_id=` +
          "{CHECKOUT_SESSION_ID}",
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
    };
  }

  async handleWebhook(payload: Buffer, signature: string): Promise<void> {
    let event: Stripe.Event;

    try {
      event = this.#stripe.webhooks.constructEvent(
        payload,
        signature,
        this.#webhookSecret,
      );
    } catch (error) {
      throw new InvalidStripeWebhookError(
        error instanceof Error ? error.message : "Invalid Stripe signature",
      );
    }

    if (
      event.type !== "checkout.session.completed" &&
      event.type !== "checkout.session.async_payment_succeeded"
    ) {
      return;
    }

    const checkout = await this.#stripe.checkout.sessions.retrieve(
      event.data.object.id,
      { expand: ["line_items"] },
    );

    if (checkout.payment_status !== "paid") return;

    await this.#fulfillCheckout(checkout);
  }

  async checkoutStatus(
    checkoutSessionId: string,
  ): Promise<"paid" | "pending" | "unknown"> {
    const order = await this.#store.getTicketOrderByCheckoutSession(
      checkoutSessionId,
    );
    return order?.status ?? "unknown";
  }

  async #fulfillCheckout(checkout: Stripe.Checkout.Session): Promise<void> {
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

    if (
      checkout.amount_total === null ||
      checkout.currency === null ||
      checkout.amount_total !== event.ticket_price_cents ||
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

    await this.#store.fulfillTicketOrder(
      order.id,
      checkout.id,
      details,
    );
  }
}

function integerMetadata(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function currentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}
