// Two protections applied to everything the person provides before it reaches a model.

const DATA_TAGS = [
  "requirements",
  "proposals",
  "debate",
  "answers",
  "context",
  "solution",
  "probe",
  "profile",
  "rates",
  "checks",
  "verdict",
  "document",
  "extraction",
  "research",
  "sources",
  "persona",
];
const TAG_PATTERN = new RegExp(`<(/?)(${DATA_TAGS.join("|")})\\b`, "gi");

/**
 * Wraps untrusted text in a data tag. Any tag of ours inside the text is defused, so an
 * imported document cannot close the block early and slip instructions after it.
 */
export function fence(tag: string, text: string): string {
  return `<${tag}>\n${text.replace(TAG_PATTERN, "‹$1$2")}\n</${tag}>`;
}

type Rule = [RegExp, string, ((match: string) => boolean)?];

const digits = (text: string) => text.replace(/\D/g, "");

function luhn(number: string): boolean {
  let sum = 0;
  for (let i = 0; i < number.length; i++) {
    let digit = Number(number[number.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

// A French SIRET (14 digits, "123 456 789 00012") passes the Luhn check by design: it is a company's public number, not
// a card. A 14-digit card is written in groups of 4, 6 and 4.
function looksLikeCard(match: string): boolean {
  const number = digits(match);
  if (number.length === 14 && !/^\d{4}[ -]\d{6}[ -]\d{4}$/.test(match)) return false;
  return luhn(number);
}

function looksLikePhone(match: string): boolean {
  const count = digits(match).length;
  if (count < 9 || count > 15) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(match)) return false;
  return /^[+(0]/.test(match) || /^\d{3}[-. ]\d{3}[-. ]\d{4}$/.test(match);
}

const RULES: Rule[] = [
  // Secrets first: they can contain digits that look like phone or card numbers.
  [/\bsk-ant-[A-Za-z0-9_-]{16,}/g, "[secret]"],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, "[secret]"],
  [/\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, "[secret]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[secret]"],
  [/\bAIza[0-9A-Za-z_-]{35}/g, "[secret]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[secret]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[secret]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g, "[iban]"],
  [/\b\d(?:[ -]?\d){12,18}\b/g, "[card]", looksLikeCard],
  [/(?<![\w.])(?:\+|\(|\b)\d[\d ().-]{7,}\d(?![\w.])/g, "[phone]", looksLikePhone],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]", (match) => match.split(".").every((part) => Number(part) <= 255)],
];

// Day rates stay with the agency: what a client reads gives amounts and days, never the rate behind them. Proposers
// state the rates they assume, and the models that read them may repeat them anywhere in their text.

const RATE_WORDS =
  /\b(?:day|daily|hourly|blended)[ -]?rates?\b|\brates? (?:assumed|used)\b|\bassumed rates?\b|\bTJM\b|\btaux (?:journaliers?|horaires?)\b|\btarifs? (?:journaliers?|horaires?)\b|\bprix de (?:la )?journée\b|tagess[aä]tze?|stundens[aä]tze?|\btarifas? (?:diarias?|por hora)\b|\btariff[ae] (?:giornalier[ae]|orari[ae])\b|\btaxas? (?:diárias?|horárias?)\b|\bvalor da diária\b|日単価|日額|人日単価|人月単価|日费率|人天单价|人日单价|दैनिक दर|السعر اليومي|الأجر اليومي/iu;
const MONEY = String.raw`(?:[€$£¥₹円元]|\b(?:eur|usd|gbp|chf|cad|aud|jpy|cny|inr|sar|aed|euros?|dollars?)\b)`;
const AMOUNT = String.raw`\d[\d\s.,'’]*(?:k|万)?`;
const PRICE = String.raw`(?:${MONEY}\s?${AMOUNT}|${AMOUNT}\s?${MONEY})`;
// An amount directly followed by "per day" or "per hour", in the languages of the interface.
const PRICE_PER_TIME = new RegExp(
  String.raw`${PRICE}\s*(?:\/|\bper\b|\ba\b|\ban\b|\bpar\b|\bpro\b|\bal\b|\bpor\b|\bao\b|每)\s*(?:person[- ]?|man[- ]?|homme[- ]?)?(?:days?|jours?|journée|j|tag|día|dia|giorno|hours?|h|heures?|stunde|std|hora|ora|日|天|人日|小时)(?![\p{L}])`,
  "iu",
);
// "Per day" first, then what it is billed: "each day is billed €700", "chaque jour est facturé 700 €", and the
// Chinese, Japanese, Hindi and Arabic word order. "200 bookings a day cost €40" is not a rate: the verb must follow.
const TIME_THEN_PRICE = new RegExp(
  String.raw`\b(?:each|every|per|one|chaque|par|pro|jeder|cada|por|ogni) (?:person[- ])?(?:day|hour|jour|journée|heure|tag|stunde|día|hora|giorno|ora|dia)\b,? (?:(?:is|are|was|est|wird|es|è|é) )?(?:billed|charged|invoiced|costs?|factur\p{L}*|coûte|kostet|berechnet|cuesta|cobra\p{L}*|costa|fatturat\p{L}*|custa|faturad\p{L}*)\b[^.!?;:。]{0,10}?${PRICE}|(?:每人?[日天]|1日あたり|一日あたり|प्रति दिन|في اليوم|يوميًا|يوميا)\s*${PRICE}|${PRICE}\s*(?:daily|hourly)\b`,
  "iu",
);

/** True when a text states a day rate or an hourly rate: a rate word, or an amount per day or per hour. */
export function mentionsRate(text: string): boolean {
  return RATE_WORDS.test(text) || PRICE_PER_TIME.test(text) || TIME_THEN_PRICE.test(text);
}

/** The items of a list that state no rate. */
export function withoutRateItems(items: string[]): string[] {
  return items.filter((item) => !mentionsRate(item));
}

/** A text without the sentences that state a rate; its lines are kept. */
export function withoutRateSentences(text: string): string {
  if (!mentionsRate(text)) return text;
  return text
    .split("\n")
    .map((line) =>
      // Sentences end with a full stop and a space, or with a full-width stop: "€0.25" is not cut.
      line
        .split(/(?<=[.!?])\s+|(?<=[。！？])/u)
        .filter((sentence) => !mentionsRate(sentence))
        .join(" ")
        .replace(/(?<=[。！？]) /gu, ""),
    )
    .filter((line, index, lines) => line.trim() || (index > 0 && lines[index - 1]?.trim()))
    .join("\n")
    .trim();
}

/**
 * A model-written value (a verdict, a proposal, a brief) without what states a rate: the sentences of every text, the
 * items of every list of texts. Numbers and the shape are kept.
 */
export function withoutRates<T>(value: T): T {
  if (typeof value === "string") return withoutRateSentences(value) as T;
  if (Array.isArray(value)) {
    const items = value.every((item) => typeof item === "string") ? withoutRateItems(value as string[]) : value;
    return items.map((item) => withoutRates(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutRates(item)])) as T;
  }
  return value;
}

/** Masks personal data and secrets. Figures that matter to the debate (prices, dates, counts) survive. */
export function redact(text: string): string {
  let out = text;
  for (const [pattern, label, accept] of RULES) {
    out = out.replace(pattern, (match) => (!accept || accept(match) ? label : match));
  }
  return out;
}
