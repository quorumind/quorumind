/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { guardNumberFields } from "./numberFields.ts";

describe("number fields", () => {
  let stop = () => undefined as void;
  afterEach(() => stop());

  it("refuse an exponent and a plus sign, but not digits or a minus", () => {
    stop = guardNumberFields();
    const input = document.createElement("input");
    input.type = "number";
    document.body.append(input);
    const press = (key: string) => {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(press("e")).toBe(true);
    expect(press("+")).toBe(true);
    expect(press("1")).toBe(false);
    expect(press("-")).toBe(false);
  });

  it("leave a text field alone", () => {
    stop = guardNumberFields();
    const input = document.createElement("input");
    document.body.append(input);
    const event = new KeyboardEvent("keydown", { key: "e", bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("refuse a pasted exponent and accept a pasted number", () => {
    stop = guardNumberFields();
    const input = document.createElement("input");
    input.type = "number";
    document.body.append(input);
    const paste = (text: string) => {
      const event = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
      event.clipboardData = { getData: () => text };
      input.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(paste("12e3")).toBe(true);
    expect(paste("1,5")).toBe(false);
    expect(paste("-20")).toBe(false);
  });

  it("let the wheel scroll the page without moving the focus or the caret from the field", async () => {
    stop = guardNumberFields();
    const input = document.createElement("input");
    input.type = "number";
    document.body.append(input);
    input.focus();
    input.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    // Read-only for the wheel's turn (the browser leaves the value alone), focused throughout.
    expect(input.readOnly).toBe(true);
    expect(document.activeElement).toBe(input);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(input.readOnly).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  it("do not take the focus back from an element the person moved to", async () => {
    stop = guardNumberFields();
    const input = document.createElement("input");
    input.type = "number";
    const other = document.createElement("input");
    document.body.append(input, other);
    input.focus();
    input.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    other.focus();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(document.activeElement).toBe(other);
  });

  it("leave a read-only field read-only", async () => {
    stop = guardNumberFields();
    const input = document.createElement("input");
    input.type = "number";
    input.readOnly = true;
    document.body.append(input);
    input.focus();
    input.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(input.readOnly).toBe(true);
  });

  it("keep the minus sign, typed or pasted, for the fields that take a negative value", () => {
    stop = guardNumberFields();
    const input = document.createElement("input");
    input.type = "number";
    document.body.append(input);
    const key = new KeyboardEvent("keydown", { key: "-", bubbles: true, cancelable: true });
    input.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(false);
    const paste = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    paste.clipboardData = { getData: () => "-95" };
    input.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(false);
  });
});
