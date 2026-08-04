export function formatCurrencyAmount(cents: number, currency: string): string {
  if (currency.toLowerCase() === "aud") {
    return `A$${(cents / 100).toFixed(2)}`;
  }

  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}
