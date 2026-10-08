import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bodiesOf, fixtureCase, mockApi } from "@/features/support/test-fixtures";
import { StoryStartControls } from "./StoryStartControls";

describe("StoryStartControls", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("adds a missing product photo in place instead of a disabled Start", async () => {
    const withPhoto = fixtureCase();
    const fetchMock = mockApi({
      "POST /api/cases/case_1/assets": () => ({ status: 201, body: {} }),
      "GET /api/cases/case_1": () => ({ status: 200, body: { case: withPhoto } }),
    });
    const onCaseChange = vi.fn();
    const { container } = render(
      <StoryStartControls
        caseData={fixtureCase({ product: null, productRevisionId: null })}
        onCaseChange={onCaseChange}
        onStart={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Start the story" })).toBeNull();
    const add = screen.getByRole("button", { name: /Add a product photo/ });
    expect((add as HTMLButtonElement).disabled).toBe(false);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "vacuum.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onCaseChange).toHaveBeenCalledWith(withPhoto));
    expect(
      fetchMock.mock.calls.filter(
        ([u, init]) => u === "/api/cases/case_1/assets" && init?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("saves a typed account as the case's own words, then starts the story", async () => {
    const saved = fixtureCase({ originalAccount: "It stops, then jerks backward." });
    const fetchMock = mockApi({
      "PATCH /api/cases/case_1": () => ({ status: 200, body: { case: saved } }),
    });
    const onCaseChange = vi.fn();
    const onStart = vi.fn();
    render(
      <StoryStartControls
        caseData={fixtureCase({ originalAccount: "" })}
        onCaseChange={onCaseChange}
        onStart={onStart}
      />,
    );
    const start = screen.getByRole("button", { name: "Start the story" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Describe what happened"), {
      target: { value: "  It stops, then jerks backward.  " },
    });
    expect(start.disabled).toBe(false);
    fireEvent.click(start);

    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    expect(onCaseChange).toHaveBeenCalledWith(saved);
    expect(bodiesOf(fetchMock, "PATCH", "/api/cases/case_1")).toEqual([
      { originalAccount: "It stops, then jerks backward." },
    ]);
  });

  it("starts straight away when the case already has its photo and account", () => {
    const fetchMock = mockApi({});
    const onStart = vi.fn();
    render(
      <StoryStartControls caseData={fixtureCase()} onCaseChange={vi.fn()} onStart={onStart} />,
    );
    expect(screen.queryByLabelText("Describe what happened")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start the story" }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
