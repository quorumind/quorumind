/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { describe, expect, it } from "vitest";
import i18n, { switchLanguage } from "./i18n.ts";

describe("the languages of the interface", () => {
  it("bundles English only, and loads another language when it is chosen", async () => {
    expect(i18n.hasResourceBundle("en", "translation")).toBe(true);
    expect(i18n.hasResourceBundle("ja", "translation")).toBe(false);
    await switchLanguage("ja", true);
    expect(i18n.language).toBe("ja");
    expect(i18n.t("nav.settings")).toBe("設定");
    expect(document.documentElement.lang).toBe("ja");
    expect(localStorage.getItem("quorumind.locale")).toBe("ja");
  });

  it("follows a questionnaire's language without remembering it, right to left for Arabic", async () => {
    localStorage.setItem("quorumind.locale", "en");
    await switchLanguage("ar", false);
    expect(document.documentElement.dir).toBe("rtl");
    expect(localStorage.getItem("quorumind.locale")).toBe("en");
    await switchLanguage("en", false);
    expect(document.documentElement.dir).toBe("ltr");
  });
});
