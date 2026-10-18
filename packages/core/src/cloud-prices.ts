import data from "../reference/cloud-prices.json" with { type: "json" };

// Reference prices of common infrastructure items in Europe, maintained by hand in reference/cloud-prices.json with the
// address each figure was read from and the date it was read. The proposers get them as reference figures, so that
// running costs do not rest on the models' memory alone; the reports say which date they were from.

export const CLOUD_PROVIDERS = ["ovhcloud", "scaleway", "aws", "azure", "gcp"] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

export const PRICE_ITEMS = ["vm_small", "managed_postgresql", "object_storage", "egress"] as const;
export type PriceItemKind = (typeof PRICE_ITEMS)[number];

const UNITS = ["hour", "month", "GB-month", "GiB-month", "GB", "GiB"] as const;
const CURRENCIES = ["EUR", "USD"] as const;

export interface PriceItem {
  provider: CloudProvider;
  item: PriceItemKind;
  /** The exact offer, with its size: "Instance POP2-2C-8G (2 dedicated vCPU, 8 GB RAM)". */
  offer: string;
  region: string;
  price: number;
  currency: (typeof CURRENCIES)[number];
  unit: (typeof UNITS)[number];
  note?: string;
  /** The public price page or price API the figure was read from. */
  source: string;
}

export interface PriceReference {
  /** The day the figures were read, as YYYY-MM-DD. */
  asOf: string;
  note: string;
  items: PriceItem[];
}

/** After this many days the file is out of date: `npm run prices:check` warns, and its figures must be read again. */
export const PRICE_MAX_AGE_DAYS = 90;

const PROVIDER_NAMES: Record<CloudProvider, string> = {
  ovhcloud: "OVHcloud",
  scaleway: "Scaleway",
  aws: "AWS",
  azure: "Microsoft Azure",
  gcp: "Google Cloud",
};

const ITEM_NAMES: Record<PriceItemKind, string> = {
  vm_small: "small virtual machine",
  managed_postgresql: "managed PostgreSQL",
  object_storage: "object storage",
  egress: "internet egress",
};

/** The problems of a price file, empty when it is valid: what the tests and the age check report. */
export function priceReferenceProblems(value: unknown): string[] {
  const problems: string[] = [];
  const reference = value as Partial<PriceReference> | null;
  if (!reference || typeof reference !== "object") return ["The price file is not an object."];
  if (typeof reference.asOf !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(reference.asOf) || Number.isNaN(Date.parse(reference.asOf))) {
    problems.push('"asOf" must be a date written YYYY-MM-DD.');
  }
  if (!Array.isArray(reference.items) || reference.items.length === 0) return [...problems, '"items" must list at least one price.'];
  reference.items.forEach((item, index) => {
    const at = `items[${index}]`;
    if (!CLOUD_PROVIDERS.includes(item.provider)) problems.push(`${at}: unknown provider "${item.provider}".`);
    if (!PRICE_ITEMS.includes(item.item)) problems.push(`${at}: unknown item "${item.item}".`);
    if (!CURRENCIES.includes(item.currency)) problems.push(`${at}: unknown currency "${item.currency}".`);
    if (!UNITS.includes(item.unit)) problems.push(`${at}: unknown unit "${item.unit}".`);
    if (typeof item.price !== "number" || !Number.isFinite(item.price) || item.price < 0)
      problems.push(`${at}: the price must be a number.`);
    if (typeof item.offer !== "string" || !item.offer.trim()) problems.push(`${at}: the offer must be named.`);
    if (typeof item.region !== "string" || !item.region.trim()) problems.push(`${at}: the region must be named.`);
    if (typeof item.source !== "string" || !/^https:\/\//.test(item.source)) problems.push(`${at}: the source must be an https address.`);
  });
  return problems;
}

function load(value: unknown): PriceReference {
  const problems = priceReferenceProblems(value);
  if (problems.length > 0) throw new Error(`reference/cloud-prices.json is invalid:\n${problems.join("\n")}`);
  return value as PriceReference;
}

export const PRICE_REFERENCE: PriceReference = load(data);

/** Whole days between the date of the figures and `now`. */
export function priceAgeDays(reference: Pick<PriceReference, "asOf"> = PRICE_REFERENCE, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(`${reference.asOf}T00:00:00Z`)) / 86_400_000));
}

export function isPriceReferenceStale(reference: Pick<PriceReference, "asOf"> = PRICE_REFERENCE, now = new Date()): boolean {
  return priceAgeDays(reference, now) > PRICE_MAX_AGE_DAYS;
}

const UNIT_TEXT: Record<PriceItem["unit"], string> = {
  hour: "per hour",
  month: "per month",
  "GB-month": "per GB-month",
  "GiB-month": "per GiB-month",
  GB: "per GB",
  GiB: "per GiB",
};

/** The reference prices as the proposers read them, appended to their instructions. */
export function priceReferenceRule(reference: PriceReference = PRICE_REFERENCE): string {
  const lines = PRICE_ITEMS.flatMap((kind) => {
    const items = reference.items.filter((item) => item.item === kind);
    if (items.length === 0) return [];
    return [
      `${ITEM_NAMES[kind]}:`,
      ...items.map(
        (item) =>
          `- ${PROVIDER_NAMES[item.provider]}, ${item.region}: ${item.offer}, ${item.price} ${item.currency} ${UNIT_TEXT[item.unit]}${item.note ? ` (${item.note})` : ""}`,
      ),
    ];
  });
  return `

Reference cloud prices, as of ${reference.asOf}: public list prices excluding VAT, on demand, before discounts, read from each provider's price page.
They are reference figures, not quotes: check them before committing. Use them to estimate the monthly running cost when the option uses
these providers or comparable offers (a month is about 730 hours), say in the cost basis which ones you used, and convert to the debate's currency
with a stated rate when they differ. Anything not listed here stays an estimate.
${lines.join("\n")}`;
}
