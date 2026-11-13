/** @vitest-environment happy-dom */
import "../test/dom.ts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { type FormEvent, useState } from "react";
import { describe, expect, it } from "vitest";
import { ApiError } from "../api.ts";
import { CharCounter, Field, FieldError, fieldProps, serverField, useFieldErrors } from "./Field.tsx";

/** A form as the interface writes them: no native validation, a message under each field, the focus on the first at fault. */
function Form({ onServer }: { onServer?: (handled: boolean) => void }) {
  const fields = useFieldErrors();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Enter a name.";
    if (!email.includes("@")) next.email = "Enter an address such as name@example.com.";
    fields.report(next);
  };
  return (
    <form ref={fields.form} noValidate onSubmit={submit}>
      <Field id="name" label="Name" hint="As on your card." error={fields.errors.name}>
        {(props) => (
          <input
            {...props}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              fields.clear("name");
            }}
          />
        )}
      </Field>
      <Field id="email" label="E-mail" error={fields.errors.email}>
        {(props) => <input {...props} value={email} onChange={(event) => setEmail(event.target.value)} />}
      </Field>
      <button type="submit">Send</button>
      <button
        type="button"
        onClick={() =>
          onServer?.(
            fields.reportServer(new ApiError(400, "invalid_request", "bad", { field: "email" }), { email: "email" }, "Not accepted."),
          )
        }
      >
        Server
      </button>
    </form>
  );
}

describe("a form with the field pattern", () => {
  it("shows the translated message under each field at fault, with aria-invalid and aria-describedby", () => {
    render(<Form />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const name = screen.getByLabelText("Name");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    const described = (name.getAttribute("aria-describedby") ?? "").split(" ");
    expect(described).toContain("name-hint");
    expect(described).toContain("name-error");
    expect(document.getElementById("name-error")?.textContent).toBe("Enter a name.");
    expect(screen.getByLabelText("E-mail").getAttribute("aria-invalid")).toBe("true");
  });

  it("puts the focus on the first field at fault, in page order", () => {
    render(<Form />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
  });

  it("moves on to the next field at fault once the first is right", () => {
    render(<Form />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("E-mail"));
  });

  it("drops the message of a field as soon as it is edited", () => {
    render(<Form />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "A" } });
    const name = screen.getByLabelText("Name");
    expect(name.getAttribute("aria-invalid")).toBeNull();
    expect(name.getAttribute("aria-describedby")).toBe("name-hint");
    expect(document.getElementById("name-error")).toBeNull();
  });

  it("attaches the server's refusal to the field named in params.field", () => {
    let handled: boolean | null = null;
    render(<Form onServer={(value) => (handled = value)} />);
    fireEvent.click(screen.getByRole("button", { name: "Server" }));
    expect(handled).toBe(true);
    expect(screen.getByLabelText("E-mail").getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("email-error")?.textContent).toBe("Not accepted.");
    expect(document.activeElement).toBe(screen.getByLabelText("E-mail"));
  });
});

describe("the server's field name", () => {
  it("is read from params.field of an API error, and only from there", () => {
    expect(serverField(new ApiError(400, "invalid_request", "x", { field: "budgetUsd" }))).toBe("budgetUsd");
    expect(serverField(new ApiError(400, "invalid_request", "x"))).toBeNull();
    expect(serverField(new Error("x"))).toBeNull();
  });

  it("leaves a refusal for a field the form does not have to the caller", () => {
    function Probe() {
      const fields = useFieldErrors();
      return (
        <button
          type="button"
          onClick={() => {
            document.title = String(
              fields.reportServer(new ApiError(400, "invalid_request", "x", { field: "other" }), { email: "email" }, "No."),
            );
          }}
        >
          Go
        </button>
      );
    }
    render(<Probe />);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(document.title).toBe("false");
  });

  it("builds the attributes of a control by hand for markup the Field does not wrap", () => {
    expect(fieldProps("x", "Wrong", "x-hint")).toEqual({ "aria-invalid": true, "aria-describedby": "x-hint x-error" });
    expect(fieldProps("x", null)).toEqual({});
    render(<FieldError id="x" error="Wrong" />);
    expect(document.getElementById("x-error")?.textContent).toBe("Wrong");
  });
});

describe("the character counter", () => {
  const live = () => document.querySelector("[aria-live=polite]") as HTMLElement;
  const count = (value: string) => render(<CharCounter id="note" value={value} max={100} />);

  it("stays hidden under 80 % of the limit", () => {
    count("a".repeat(79));
    expect(document.getElementById("note-counter")).toBeNull();
  });

  it("shows from 80 % of the limit", () => {
    count("a".repeat(80));
    const counter = document.getElementById("note-counter");
    expect(counter?.textContent).toBe("80 / 100");
  });

  it("is announced at 90 % and at the limit, not before", async () => {
    const view = count("a".repeat(89));
    expect(live().textContent).toBe("");
    await act(async () => view.rerender(<CharCounter id="note" value={"a".repeat(90)} max={100} />));
    expect(live().textContent).toContain("100");
    const near = live().textContent;
    await act(async () => view.rerender(<CharCounter id="note" value={"a".repeat(95)} max={100} />));
    expect(live().textContent).toBe(near);
    await act(async () => view.rerender(<CharCounter id="note" value={"a".repeat(100)} max={100} />));
    expect(live().textContent).not.toBe(near);
  });
});
