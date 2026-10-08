import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { CaseLoadError } from "./CaseLoadError";

afterEach(cleanup);

function renderError(code: string, message: string) {
  return render(
    <MemoryRouter>
      <CaseLoadError code={code} message={message} />
    </MemoryRouter>,
  );
}

describe("CaseLoadError", () => {
  it("never asks for a code it has no box for: access errors point to the products", () => {
    renderError("ACCESS_REQUIRED", "Enter the demo access code to continue.");
    expect(screen.queryByText("Enter the demo access code to continue.")).toBeNull();
    expect(screen.getByRole("heading").textContent).toBe("This case belongs to another session");
    expect(screen.getByText(/you enter the demo access code there/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to products" }).getAttribute("href")).toBe("/");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("treats an expired session the same way", () => {
    renderError("SESSION_EXPIRED", "Your session expired. Enter the access code again.");
    expect(screen.getByRole("heading").textContent).toBe("This case belongs to another session");
  });

  it("shows other failures with a retry next to the way back", () => {
    renderError("NOT_FOUND", "Not found.");
    expect(screen.getByRole("heading").textContent).toBe("This case could not be opened");
    expect(screen.getByText("Not found.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to products" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
