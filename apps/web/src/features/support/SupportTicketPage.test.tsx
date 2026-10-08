import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TicketAttachment } from "@symptomsketch/contracts";
import { SupportTicketPage } from "./SupportTicketPage";
import { bodiesOf, fixtureCase, fixtureTake, fixtureTicket, mockApi } from "./test-fixtures";

const SUPPORT = {
  authenticated: true,
  role: "support",
  accessGranted: true,
  expiresAt: "2026-10-15T10:00:00.000Z",
};

function attachment(over: Partial<TicketAttachment>): TicketAttachment {
  return {
    id: "att_1",
    ticketId: "tkt_1",
    assetId: "ast_1",
    purpose: "customer_reference",
    mime: "image/jpeg",
    sha256: "d".repeat(64),
    sizeBytes: 100_000,
    filename: "reference.jpg",
    durationMs: null,
    mediaUrl: "/api/tickets/tkt_1/attachments/ast_1/media",
    downloadUrl: "/api/tickets/tkt_1/attachments/ast_1/download",
    createdAt: "2026-10-08T10:00:00.000Z",
    ...over,
  };
}

const TICKET = fixtureTicket({
  workCaseIds: ["case_w"],
  snapshot: {
    ...fixtureTicket().snapshot,
    reviewState: "accepted",
    uncertaintyNote: "Not sure the jerk is that small",
  },
  attachments: [
    attachment({ purpose: "customer_take", id: "att_2", assetId: "ast_2", mime: "video/mp4" }),
    attachment({}),
  ],
});

function WorkspaceMarker() {
  const { caseId, tab } = useParams();
  return <p>workspace {`${caseId}/${tab}`}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/support/tickets/tkt_1"]}>
      <Routes>
        <Route path="/support/tickets/:ticketId" element={<SupportTicketPage />} />
        <Route path="/cases/:caseId/:tab" element={<WorkspaceMarker />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SupportTicketPage", () => {
  beforeEach(() => window.sessionStorage.clear());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the snapshot with playable attachments and posts a reply carrying an accepted work-case take", async () => {
    const solution = fixtureTake({
      id: "take_s",
      caseId: "case_w",
      purpose: "solution",
      number: 1,
      caption: "Lift the bumper, then press start",
      mediaUrl: "/api/takes/take_s/media",
    });
    const fetchMock = mockApi({
      "GET /api/session": () => ({ status: 200, body: SUPPORT }),
      "GET /api/tickets/tkt_1": () => ({ status: 200, body: { ticket: TICKET } }),
      "GET /api/cases/case_w": () => ({
        status: 200,
        body: {
          case: fixtureCase({
            id: "case_w",
            ownerRole: "support",
            mode: "solution",
            sourceTicketId: "tkt_1",
            takes: [
              solution,
              fixtureTake({
                id: "take_x",
                purpose: "solution",
                number: 2,
                reviewState: "uncertain",
              }),
            ],
          }),
        },
      }),
      "POST /api/tickets/tkt_1/replies": () => ({
        status: 201,
        body: {
          ticket: {
            ...TICKET,
            status: "replied",
            replies: [
              {
                id: "rpl_1",
                ticketId: "tkt_1",
                authorRole: "support",
                authorLabel: "Demo Support teammate",
                text: "Here is how to do it.",
                attachment: null,
                createdAt: "2026-10-08T10:20:00.000Z",
              },
            ],
          },
        },
      }),
    });

    const { container } = renderPage();
    expect(await screen.findByText("The vacuum stops and then jerks backward once.")).toBeTruthy();
    expect(screen.getByText(/Not sure the jerk is that small/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back to inbox/ }).getAttribute("href")).toBe(
      "/support",
    );
    const video = container.querySelector("video");
    expect(video?.getAttribute("src")).toBe("/api/tickets/tkt_1/attachments/ast_2/media");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/api/tickets/tkt_1/attachments/ast_1/media",
    );

    const option = await screen.findByRole("radio", { name: /Take 01 · Lift the bumper/ });
    expect(screen.queryByRole("radio", { name: /Take 02/ })).toBeNull();
    fireEvent.click(option);
    fireEvent.change(screen.getByLabelText("Reply text"), {
      target: { value: "Here is how to do it." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send reply with clip/ }));

    expect(await screen.findByText("Here is how to do it.", { selector: "p" })).toBeTruthy();
    const [body] = bodiesOf(fetchMock, "POST", "/api/tickets/tkt_1/replies");
    expect(body).toMatchObject({ text: "Here is how to do it.", attachTakeId: "take_s" });
    expect(typeof body?.idempotencyKey).toBe("string");
  });

  it("Reply with a demonstration creates a work case and opens its Issue tab", async () => {
    const fetchMock = mockApi({
      "GET /api/session": () => ({ status: 200, body: SUPPORT }),
      "GET /api/tickets/tkt_1": () => ({
        status: 200,
        body: { ticket: { ...TICKET, workCaseIds: [] } },
      }),
      "POST /api/tickets/tkt_1/work-case": () => ({ status: 201, body: { caseId: "case_w2" } }),
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Reply with a demonstration/ }));
    expect(await screen.findByText("workspace case_w2/issue")).toBeTruthy();
    await waitFor(() =>
      expect(bodiesOf(fetchMock, "POST", "/api/tickets/tkt_1/work-case")).toHaveLength(1),
    );
  });

  it("shows the customer's AI support agent call transcript, labeled as AI", async () => {
    mockApi({
      "GET /api/session": () => ({ status: 200, body: SUPPORT }),
      "GET /api/tickets/tkt_1": () => ({
        status: 200,
        body: {
          ticket: {
            ...TICKET,
            workCaseIds: [],
            aiCallTranscripts: [
              {
                id: "sct_1",
                ticketId: "tkt_1",
                lines: [
                  { speaker: "character", text: "Hi, I'm Sam, an AI support agent." },
                  { speaker: "user", text: "It jerks back after it stops.", typed: true },
                ],
                durationSeconds: 75,
                endReason: "ended_by_client",
                createdAt: "2026-10-08T10:30:00.000Z",
              },
            ],
          },
        },
      }),
    });
    renderPage();
    const heading = await screen.findByRole("heading", {
      name: "AI support agent call transcript",
    });
    const section = heading.closest("section");
    expect(section?.textContent).toContain("Call · 1:15");
    expect(section?.textContent).toContain("Sam (AI)");
    expect(section?.textContent).toContain("Customer · typed");
    expect(section?.textContent).toContain("It jerks back after it stops.");
    expect(section?.querySelector(".font-reactor")?.textContent).toBe("Reactor Vidu S2 Avatar");
  });
});
