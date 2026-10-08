import { describe, expect, it } from "vitest";
import {
  EMPTY_TRANSCRIPT,
  addTypedLine,
  applyTranscript,
  callCapSeconds,
  finalLines,
  formatClock,
  phaseFromSession,
} from "./support-call-model";

describe("support call transcript", () => {
  it("shows interim text per speaker and settles it on final", () => {
    let s = applyTranscript(EMPTY_TRANSCRIPT, {
      speaker: "character",
      text: "Hi, I'm",
      final: false,
    });
    expect(s.interim.character).toBe("Hi, I'm");
    expect(s.lines).toHaveLength(0);
    s = applyTranscript(s, { speaker: "character", text: "Hi, I'm Sam.", final: true });
    expect(s.interim.character).toBeUndefined();
    expect(s.lines).toEqual([{ id: 1, speaker: "character", text: "Hi, I'm Sam." }]);
  });

  it("lists a typed message once even if the model echoes it as user speech", () => {
    let s = addTypedLine(EMPTY_TRANSCRIPT, "It jerks after it stops.", 1_000);
    s = applyTranscript(
      s,
      { speaker: "user", text: "it jerks after it stops", final: true },
      2_000,
    );
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]).toMatchObject({ speaker: "user", typed: true });
    s = applyTranscript(
      s,
      { speaker: "user", text: "It jerks after it stops.", final: true },
      3_000,
    );
    expect(s.lines).toHaveLength(2);
  });

  it("maps unknown speakers to the character and drops empty finals", () => {
    let s = applyTranscript(EMPTY_TRANSCRIPT, { speaker: "assistant", text: "Okay.", final: true });
    s = applyTranscript(s, { speaker: "user", text: "  ", final: true });
    expect(s.lines.map((l) => l.speaker)).toEqual(["character"]);
    expect(finalLines(s)).toEqual([{ speaker: "character", text: "Okay." }]);
  });
});

describe("support call phases and clock", () => {
  it("maps SDK phases to the four plain labels", () => {
    expect(phaseFromSession("preparing_avatar", false)).toBe("preparing");
    expect(phaseFromSession("avatar_ready", false)).toBe("preparing");
    expect(phaseFromSession("warming_up", true)).toBe("connecting");
    expect(phaseFromSession("live", true)).toBe("live");
    expect(phaseFromSession("ended", true)).toBe("ended");
    expect(phaseFromSession("failed", false)).toBe("preparing");
  });

  it("caps the call at the client limit and formats m:ss", () => {
    expect(callCapSeconds(null)).toBe(240);
    expect(callCapSeconds(600)).toBe(240);
    expect(callCapSeconds(120)).toBe(120);
    expect(formatClock(65)).toBe("1:05");
  });
});
