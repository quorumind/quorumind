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
  [/\b\d(?:[ -]?\d){12,18}\b/g, "[card]", (match) => luhn(digits(match))],
  [/(?<![\w.])(?:\+|\(|\b)\d[\d ().-]{7,}\d(?![\w.])/g, "[phone]", looksLikePhone],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]", (match) => match.split(".").every((part) => Number(part) <= 255)],
];

/** Masks personal data and secrets. Figures that matter to the debate (prices, dates, counts) survive. */
export function redact(text: string): string {
  let out = text;
  for (const [pattern, label, accept] of RULES) {
    out = out.replace(pattern, (match) => (!accept || accept(match) ? label : match));
  }
  return out;
}
