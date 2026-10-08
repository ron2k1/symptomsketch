import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupportInboxPage } from "./SupportInboxPage";
import { mockApi } from "./test-fixtures";

const SIGNED_OUT = { authenticated: false, role: null, accessGranted: false, expiresAt: null };
const SUPPORT = {
  authenticated: true,
  role: "support",
  accessGranted: true,
  expiresAt: "2026-10-15T10:00:00.000Z",
};

const ROW = {
  id: "tkt_1",
  status: "submitted",
  queue: "SymptomSketch Demo Support",
  caseTitle: "Robot vacuum",
  productLabel: "Robot vacuum (demo)",
  purpose: "problem",
  excerpt: "The vacuum stops and then jerks backward once.",
  assessmentStatus: "matches",
  reviewState: "accepted",
  replyCount: 0,
  lastReplyAt: null,
  createdAt: "2026-10-08T10:00:00.000Z",
  updatedAt: "2026-10-08T10:00:00.000Z",
};

describe("SupportInboxPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("gates the queue behind the server-checked support code, then lists submitted tickets", async () => {
    mockApi({
      "GET /api/session": () => ({ status: 200, body: SIGNED_OUT }),
      "POST /api/support/session": (init) => {
        const { supportCode } = JSON.parse(String(init?.body)) as { supportCode: string };
        return supportCode === "right-code"
          ? { status: 200, body: SUPPORT }
          : {
              status: 403,
              body: { code: "SUPPORT_FORBIDDEN", message: "That support code was not accepted." },
            };
      },
      "GET /api/support/tickets": () => ({ status: 200, body: { tickets: [ROW] } }),
    });

    render(
      <MemoryRouter>
        <SupportInboxPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("SymptomSketch")).toBeTruthy();
    expect(screen.getByText(/Demo Support workspace/)).toBeTruthy();

    const input = await screen.findByLabelText("Support code");
    fireEvent.change(input, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /Open Demo Support/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("That support code was not accepted.")).toBeTruthy();
    expect(screen.queryByText("Submitted tickets")).toBeNull();

    fireEvent.change(screen.getByLabelText("Support code"), { target: { value: "right-code" } });
    fireEvent.click(screen.getByRole("button", { name: /Open Demo Support/ }));
    expect(await screen.findByText("Submitted tickets")).toBeTruthy();
    expect(await screen.findByText("Robot vacuum (demo)")).toBeTruthy();
    expect(screen.getByText("Awaiting reply")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Robot vacuum \(demo\)/ });
    expect(link.getAttribute("href")).toBe("/support/tickets/tkt_1");
  });

  it("returns to the login card when the staff session expires during polling", async () => {
    mockApi({
      "GET /api/session": () => ({ status: 200, body: SUPPORT }),
      "GET /api/support/tickets": () => ({
        status: 401,
        body: { code: "SESSION_EXPIRED", message: "Your session expired." },
      }),
    });
    render(
      <MemoryRouter>
        <SupportInboxPage />
      </MemoryRouter>,
    );
    expect(await screen.findByLabelText("Support code")).toBeTruthy();
    expect(screen.getByText(/staff session ended/)).toBeTruthy();
  });
});
