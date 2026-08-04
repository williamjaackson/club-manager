import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Client } from "discord.js";
import {
  InvalidStripeWebhookError,
  type TicketingService,
} from "./ticketing.js";

const MAX_WEBHOOK_BYTES = 1024 * 1024;

export function startHttpServer(
  client: Client,
  ticketing: TicketingService,
  port: number,
  onWebhookProcessed?: () => void,
): Server {
  const server = createHttpServer(client, ticketing, onWebhookProcessed);

  server.listen(port, "0.0.0.0", () => {
    console.log(`HTTP server listening on port ${port}`);
  });

  return server;
}

export function createHttpServer(
  client: Client,
  ticketing: TicketingService,
  onWebhookProcessed?: () => void,
): Server {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/health") {
      const ready = client.isReady();
      response
        .writeHead(ready ? 200 : 503, { "content-type": "application/json" })
        .end(JSON.stringify({ ready }));
      return;
    }

    if (
      request.method === "POST" &&
      (url.pathname === "/stripe/webhook" ||
        url.pathname === "/stripe/test-webhook")
    ) {
      try {
        const signature = request.headers["stripe-signature"];

        if (typeof signature !== "string") {
          throw new InvalidStripeWebhookError(
            "Missing Stripe-Signature header",
          );
        }

        const payload = await readBody(request);
        await ticketing.handleWebhook(
          payload,
          signature,
          url.pathname === "/stripe/test-webhook" ? "test" : "primary",
        );
        response.writeHead(200).end("Received\n");
        onWebhookProcessed?.();
      } catch (error) {
        if (error instanceof InvalidStripeWebhookError) {
          response.writeHead(400).end("Invalid webhook\n");
          return;
        }

        console.error("Stripe webhook processing failed", error);
        response.writeHead(500).end("Webhook processing failed\n");
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/stripe/success") {
      const sessionId = url.searchParams.get("session_id");
      const status = sessionId
        ? await ticketing
            .checkoutStatus(sessionId)
            .catch(() => "unknown" as const)
        : "unknown";
      const message =
        status === "paid"
          ? "Your ticket is confirmed."
          : status === "refunded"
            ? "This ticket was refunded and is no longer valid."
          : "Payment received. Your ticket is being confirmed.";
      html(response, 200, "Ticket checkout", message);
      return;
    }

    if (request.method === "GET" && url.pathname === "/stripe/cancel") {
      html(
        response,
        200,
        "Checkout cancelled",
        "You were not charged. Return to Discord whenever you’re ready.",
      );
      return;
    }

    response.writeHead(404).end("Not found\n");
  });
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;

    if (bytes > MAX_WEBHOOK_BYTES) {
      throw new InvalidStripeWebhookError("Stripe webhook body is too large");
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

function html(
  response: import("node:http").ServerResponse,
  status: number,
  title: string,
  message: string,
): void {
  response
    .writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    })
    .end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
      body { font: 18px system-ui; margin: 0; background: #111827; color: #f9fafb; }
      main { max-width: 36rem; margin: 15vh auto; padding: 2rem; text-align: center; }
      h1 { font-size: 2rem; } p { line-height: 1.6; color: #d1d5db; }
    </style>
  </head>
  <body><main><h1>${title}</h1><p>${message}</p></main></body>
</html>`);
}
