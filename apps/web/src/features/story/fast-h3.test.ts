import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// TEST STUB of the Reactor client (never used by the live app): counts connect/disconnect calls and
// lets a test hold connect() open, so teardown can land before or during it.
const sdk = vi.hoisted(() => ({
  connects: 0,
  disconnects: 0,
  uploads: 0,
  release: null as null | (() => void),
  holdConnect: false,
}));

vi.mock("@reactor-team/js-sdk", async (importOriginal) => {
  const real = await importOriginal<typeof import("@reactor-team/js-sdk")>();
  class StubReactor {
    on() {}
    off() {}
    async connect() {
      sdk.connects += 1;
      if (sdk.holdConnect) await new Promise<void>((r) => (sdk.release = r));
    }
    async disconnect() {
      sdk.disconnects += 1;
    }
    async uploadFile() {
      sdk.uploads += 1;
      return { id: "stub-file-ref" };
    }
    async sendCommand() {
      return undefined;
    }
  }
  return { ...real, Reactor: StubReactor };
});

const { FastH3Session, SessionClosedError } = await import("./fast-h3");

beforeEach(() => {
  Object.assign(sdk, {
    connects: 0,
    disconnects: 0,
    uploads: 0,
    release: null,
    holdConnect: false,
  });
  vi.stubGlobal(
    "MediaStream",
    class {
      getTracks() {
        return [];
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("FastH3Session teardown vs connect", () => {
  it("never opens a session once it was disconnected (teardown before the token came back)", async () => {
    const s = new FastH3Session({});
    await s.disconnect();
    await expect(s.connect("stub.jwt")).rejects.toBeInstanceOf(SessionClosedError);
    expect(sdk.connects).toBe(0);
    await expect(s.uploadFile(new Blob(["x"]))).rejects.toBeInstanceOf(SessionClosedError);
    expect(sdk.uploads).toBe(0);
  });

  it("closes a session whose connect was in flight when it was disconnected", async () => {
    sdk.holdConnect = true;
    const s = new FastH3Session({});
    const connecting = s.connect("stub.jwt");
    await vi.waitFor(() => expect(sdk.release).not.toBeNull());
    await s.disconnect();
    sdk.release?.();
    await expect(connecting).rejects.toBeInstanceOf(SessionClosedError);
    expect(sdk.connects).toBe(1);
    // disconnect() itself plus the post-connect close: the session never outlives the teardown.
    expect(sdk.disconnects).toBeGreaterThanOrEqual(2);
  });

  it("connects normally while open", async () => {
    const s = new FastH3Session({});
    await s.connect("stub.jwt");
    expect(sdk.connects).toBe(1);
    expect(sdk.disconnects).toBe(0);
    await expect(s.uploadFile(new Blob(["x"]))).resolves.toEqual({ id: "stub-file-ref" });
  });
});
