/** @vitest-environment happy-dom */
import "../test/dom.ts";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { switchLanguage } from "../i18n.ts";
import { ShortcutHint } from "./ShortcutHint.tsx";

describe("the send shortcut's hint", () => {
  it("names Ctrl on a PC and Command on a Mac", () => {
    vi.stubGlobal("navigator", { platform: "Win32", userAgent: "Windows" });
    expect(render(<ShortcutHint />).container.textContent).toBe("Ctrl+Enter to send");
    vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "Macintosh" });
    expect(render(<ShortcutHint />).container.textContent).toContain("⌘+Enter to send");
  });

  describe("in right-to-left text", () => {
    afterEach(async () => {
      await switchLanguage("en", false);
    });

    it("sets the key combination as an isolated left-to-right run", async () => {
      vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "Macintosh" });
      await switchLanguage("ar", false);
      const { container } = render(<ShortcutHint />);
      const run = container.querySelector("bdi");
      expect(run?.getAttribute("dir")).toBe("ltr");
      // Without the isolate, "⌘+Enter" would render as "Enter+⌘" inside Arabic text.
      expect(run?.textContent).toBe("⌘+Enter");
      expect(container.textContent).toContain("للإرسال");
      expect(run?.textContent).not.toContain("للإرسال");
    });
  });
});
