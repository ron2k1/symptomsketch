import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallProvider } from "./call/CallProvider";
import { CustomerSupportTab } from "./CustomerSupportTab";
import { bodiesOf, fixtureCase, fixtureTake, fixtureTicket, mockApi } from "./test-fixtures";

const MESSAGE = {
  takeId: "take_a",
  subject: "Robot vacuum jerks backward once",
  body: "Suggested explanation body.",
  attachmentFilename: "symptomsketch-case-1-take-02.mp4",
};

function renderTab(props: Partial<Parameters<typeof CustomerSupportTab>[0]> = {}) {
  return render(
    <MemoryRouter>
      <CallProvider>
        <CustomerSupportTab
          caseId="case_1"
          caseData={fixtureCase()}
          selectedTakeId="take_a"
          onSelectTake={() => {}}
          {...props}
        />
      </CallProvider>
    </MemoryRouter>,
  );
}

describe("CustomerSupportTab", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("names both attachments and sends one idempotent ticket, showing Received only after the server stores it", async () => {
    let calls = 0;
    const fetchMock = mockApi({
      "GET /api/takes/take_a/message": () => ({ status: 200, body: MESSAGE }),
      "POST /api/cases/case_1/tickets": () => {
        calls += 1;
        return calls === 1
          ? new TypeError("network down")
          : { status: 201, body: { ticket: fixtureTicket() } };
      },
      "GET /api/tickets/tkt_1": () => ({ status: 200, body: { ticket: fixtureTicket() } }),
    });

    renderTab();
    const textarea = await screen.findByLabelText("Explanation message");
    await waitFor(() => expect((textarea as HTMLTextAreaElement).value).toBe(MESSAGE.body));
    fireEvent.change(textarea, { target: { value: "My edited explanation" } });

    expect(screen.getByText("1. Product reference (normalized)")).toBeTruthy();
    expect(screen.getByText(/2\. Accepted MP4, Take 02/)).toBeTruthy();
    expect(screen.queryByText("Received by Demo Support")).toBeNull();

    const send = screen.getByRole("button", { name: /Send to Demo Support/ });
    fireEvent.click(send);
    expect(await screen.findByText("Could not reach the server.")).toBeTruthy();
    expect(screen.queryByText("Received by Demo Support")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Send to Demo Support/ }));
    expect(await screen.findAllByText("Received by Demo Support")).not.toHaveLength(0);

    const bodies = bodiesOf(fetchMock, "POST", "/api/cases/case_1/tickets");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.idempotencyKey).toBe(bodies[1]?.idempotencyKey);
    expect(bodies[1]).toMatchObject({
      takeId: "take_a",
      message: "My edited explanation",
      includeOriginal: false,
    });
    expect(screen.queryByRole("button", { name: /Send to Demo Support/ })).toBeNull();
  });

  it("copies the selected take's explanation, falling back to manual copy without claiming an email was sent", async () => {
    mockApi({ "GET /api/takes/take_a/message": () => ({ status: 200, body: MESSAGE }) });
    renderTab();
    await waitFor(() =>
      expect((screen.getByLabelText("Explanation message") as HTMLTextAreaElement).value).toBe(
        MESSAGE.body,
      ),
    );
    const download = screen.getByRole("link", { name: /Download MP4/ });
    expect(download.getAttribute("href")).toBe("/api/takes/take_a/download");

    fireEvent.click(screen.getByRole("button", { name: /Copy email explanation/ }));
    const manual = (await screen.findByLabelText(
      /blocked clipboard access/,
    )) as HTMLTextAreaElement;
    expect(manual.value).toBe(`Subject: ${MESSAGE.subject}\n\n${MESSAGE.body}`);
    expect(screen.queryByText(/email sent/i)).toBeNull();
  });

  it("confirms a successful clipboard write with Message copied", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    mockApi({ "GET /api/takes/take_a/message": () => ({ status: 200, body: MESSAGE }) });
    renderTab();
    await waitFor(() =>
      expect((screen.getByLabelText("Explanation message") as HTMLTextAreaElement).value).toBe(
        MESSAGE.body,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /Copy email explanation/ }));
    expect(await screen.findByText("Message copied")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(`Subject: ${MESSAGE.subject}\n\n${MESSAGE.body}`);
  });

  it("prompts Recreate instead of sending when the selected take is not accepted", () => {
    mockApi({});
    renderTab({
      caseData: fixtureCase({ takes: [fixtureTake({ reviewState: "uncertain" })] }),
    });
    expect(screen.queryByRole("button", { name: /Send to Demo Support/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Go to Recreate/ }).getAttribute("href")).toBe(
      "/cases/case_1/recreate",
    );
  });

  it("shows actual replies with their playable attachment from the ticket thread", async () => {
    const reply = {
      id: "rpl_1",
      ticketId: "tkt_1",
      authorRole: "support" as const,
      authorLabel: "Demo Support teammate",
      text: "Try lifting the bumper first.",
      attachment: {
        id: "att_9",
        ticketId: "tkt_1",
        assetId: "ast_reply",
        purpose: "support_reply_take" as const,
        mime: "video/mp4",
        sha256: "c".repeat(64),
        sizeBytes: 800_000,
        filename: "symptomsketch-reply.mp4",
        durationMs: 6000,
        mediaUrl: "/api/tickets/tkt_1/attachments/ast_reply/media",
        downloadUrl: "/api/tickets/tkt_1/attachments/ast_reply/download",
        createdAt: "2026-10-08T10:10:00.000Z",
      },
      createdAt: "2026-10-08T10:10:00.000Z",
    };
    mockApi({
      "GET /api/takes/take_a/message": () => ({ status: 200, body: MESSAGE }),
      "GET /api/tickets/tkt_1": () => ({
        status: 200,
        body: { ticket: fixtureTicket({ status: "replied", replies: [reply] }) },
      }),
    });
    const summary = {
      id: "tkt_1",
      status: "submitted" as const,
      queue: "SymptomSketch Demo Support",
      takeId: "take_a",
      takeNumber: 2,
      replyCount: 0,
      lastReplyAt: null,
      createdAt: "2026-10-08T10:00:00.000Z",
      updatedAt: "2026-10-08T10:00:00.000Z",
    };
    const { container } = renderTab({ caseData: fixtureCase({ tickets: [summary] }) });
    expect(await screen.findByText("Try lifting the bumper first.")).toBeTruthy();
    const video = container.querySelector("video");
    expect(video?.getAttribute("src")).toBe("/api/tickets/tkt_1/attachments/ast_reply/media");
    expect(screen.getByText(/Demo Support teammate/)).toBeTruthy();
    expect(screen.queryByText(/typing/i)).toBeNull();
  });
});
