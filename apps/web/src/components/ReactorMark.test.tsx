import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReactorMark } from "./ReactorMark";

afterEach(cleanup);

describe("ReactorMark", () => {
  it("names the engine in the Reactor face", () => {
    render(<ReactorMark />);
    const mark = screen.getByText("Reactor X2").closest("[data-reactor-mark]");
    expect(mark).not.toBeNull();
    expect(mark!.className).toContain("font-reactor");
  });

  it("supports a custom label and a live signal dot", () => {
    const { container } = render(<ReactorMark label="Live · Reactor X2" live />);
    expect(screen.getByText("Live · Reactor X2")).toBeTruthy();
    expect(container.querySelector("[data-reactor-signal]")?.className).toContain("animate-pulse");
  });

  it("exposes size and variant as data attributes for styling hooks", () => {
    const { container } = render(<ReactorMark size="lg" variant="soft" />);
    const mark = container.querySelector("[data-reactor-mark]")!;
    expect(mark.getAttribute("data-size")).toBe("lg");
    expect(mark.getAttribute("data-variant")).toBe("soft");
  });
});
