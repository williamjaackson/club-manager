export function formatCurrencyAmount(cents: number, currency: string): string {
  if (currency.toLowerCase() === "aud") {
    return `A$${(cents / 100).toFixed(2)}`;
  }

  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

// Stripe AU domestic card pricing (1.7% + A$0.30). International cards cost
// more (3.5% + A$0.30), so these are floor estimates for admin display only.
export function estimateStripeFeeCents(amountCents: number): number {
  if (amountCents <= 0) return 0;
  return Math.round(amountCents * 0.017) + 30;
}
