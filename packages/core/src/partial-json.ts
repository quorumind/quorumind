/**
 * Reads the value of a top-level string field from JSON that is still being streamed,
 * so the interface can show a model's `speech` before the whole answer arrives.
 * Returns null until the field has started.
 */
export function partialStringField(raw: string, field: string): string | null {
  const match = new RegExp(`"${field}"\\s*:\\s*"`).exec(raw);
  if (!match) return null;
  let out = "";
  for (let i = match.index + match[0].length; i < raw.length; i++) {
    const char = raw[i];
    if (char === '"') return out;
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) return out;
    i++;
    switch (next) {
      case "n":
        out += "\n";
        break;
      case "t":
        out += "\t";
        break;
      case "r":
        break;
      case "u": {
        const hex = raw.slice(i + 1, i + 5);
        if (hex.length < 4) return out;
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 4;
        break;
      }
      default:
        out += next;
    }
  }
  return out;
}
