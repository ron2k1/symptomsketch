import type { Purpose, SelectedAction } from "@symptomsketch/contracts";

/**
 * Motion sketch (docs/providers/reactor-x2.md section 9): X2 does not move a product from prompt
 * wording alone, so the SOURCE canvas animates the product region (cut out over a clean plate,
 * translated with ease-in-out, then held) while a pointer is dragged along the same path.
 * Everything here is pure; drawing lives in source-canvas.ts, pointer sends in x2-preview.ts.
 */

/** Ellipse in normalized IMAGE coordinates (0..1 of image width / height). */
export interface MaskEllipse {
  kind: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}
/** Axis-aligned rect in normalized IMAGE coordinates. */
export interface MaskRect {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
}
export type MaskShape = MaskEllipse | MaskRect;

/** Where the product sits in its still, and which way it faces. All values normalized to the image. */
export interface ProductRegion {
  /** Union of shapes that covers the product (drawn grown by `maskGrow` for the clean plate). */
  mask: MaskShape[];
  /** Product centre (pivot for translate + scale). */
  center: { x: number; y: number };
  /** Bounding box of the mask. */
  box: MaskRect;
  /** Empty floor next to the product, tiled across the box to cover the hole. */
  cleanPlate: MaskRect;
  /** Screen-space direction the product's front points to (x right, y down; major axis = 1). */
  forward: { x: number; y: number };
}

/** One eased move of the path progress from `from` to `to` (0 = start pose, 1 = end pose). */
export interface MotionSegment {
  startMs: number;
  durMs: number;
  from: number;
  to: number;
}

export interface MotionProgram {
  /** End offset of the product centre, as a fraction of frame width / frame height. */
  dx: number;
  dy: number;
  /** Product scale at the end pose (shrinks when moving away, grows when moving closer). */
  endScale: number;
  /** Timeline relative to the run's first real output frame; the end pose holds after the last. */
  segments: MotionSegment[];
  /** Drag the X2 pointer along the same path (keeps the moved product in place and in shape). */
  pointer: boolean;
}

/** Measured limits (motion-lab, 22 live runs). */
export const MOTION = {
  delayMs: 500,
  defaultDurMs: 2000,
  minDurMs: 1500,
  maxDurMs: 2500,
  holdBetweenMs: 300,
  defaultAmplitude: 0.08,
  largeAmplitude: 0.12,
  minAmplitude: 0.06,
  maxAmplitude: 0.12,
  /** Minor-axis share of a diagonal facing (backward on the demo = (+1, -0.25)). */
  minorAxis: 0.25,
  /** Scale change per unit of amplitude along the facing axis (0.08 -> 0.97). */
  scalePerAmplitude: 0.375,
  maxRepetitions: 3,
  pointerSteps: 20,
  pointerReleaseMs: 150,
  maskGrow: 1.05,
} as const;

const NON_TRANSLATION =
  /\b(rotat\w*|spin\w*|turn\w*|swing\w*|swivel\w*|tilt\w*|oscillat\w*|wobbl\w*|vibrat\w*|shak\w*|blink\w*|flash\w*|flicker\w*|light\w*|glow\w*|beep\w*|open\w*|clos\w*|fold\w*|unfold\w*|press\w*)\b/;
/**
 * Whole-word verbs for the product itself travelling. Bare direction words ("steps back") and
 * nouns ("headlight", "the head swings") are not travel verbs.
 */
const TRAVEL =
  /\b(mov(e|es|ed|ing)|driv(e|es|ing)|drove|roll(s|ed|ing)?|slid(e|es|ing)?|jerk(s|ed|ing)?|lurch(es|ed|ing)?|back(s|ed|ing)|revers(e|es|ed|ing)|creep(s|ing)?|crept|travel(s|ed|led|ing|ling)?|shift(s|ed|ing)?|jump(s|ed|ing)?|scoot(s|ed|ing)?|bump(s|ed|ing)?|go(es|ing)?|went|heads|headed|heading|lift(s|ed|ing)?|ris(e|es|ing)|rose|drop(s|ped|ping)?|fall(s|ing)?|fell|sink(s|ing)?|sank|descend(s|ed|ing)?|ascend(s|ed|ing)?|fl(y|ies|ying|ew)|drift(s|ed|ing)?)\b/;
const NEGATION =
  /\b(not|never|without|cannot|no longer|fails? to|failed to|stops?|stopped)\b|n['’]t\b/;
const CLAUSE_BREAK = /[,;:.!?]|\b(?:and|but|then)\b/;

/**
 * True when `re` matches somewhere in `text` with no negation in the 3 words before it, within the
 * same clause ("does not move", "stops moving", "without stopping or reversing" are negated;
 * "stops, then jerks backward" is not).
 */
function affirmed(text: string, re: RegExp): boolean {
  for (const m of text.matchAll(new RegExp(re.source, "g"))) {
    const clause =
      text
        .slice(0, m.index ?? 0)
        .split(CLAUSE_BREAK)
        .pop() ?? "";
    const near = clause.trim().split(/\s+/).slice(-3).join(" ");
    if (!NEGATION.test(near)) return true;
  }
  return false;
}

type Vec = { x: number; y: number };
interface Heading {
  v: Vec;
  /** +1 moves away from the camera (shrink), -1 toward it (grow), 0 keeps size. */
  depth: -1 | 0 | 1;
}

function headingFor(text: string, forward: Vec): Heading | null {
  const has = (re: RegExp) => affirmed(text, re);
  const back = { x: -forward.x, y: -forward.y };
  if (has(/\b(back|backs|backed|backing|backwards?|revers(e|es|ed|ing)|rear|rearwards?)\b/)) {
    return { v: back, depth: forward.y > 0 ? 1 : -1 };
  }
  if (has(/\b(forwards?|ahead|front)\b/)) return { v: forward, depth: forward.y > 0 ? -1 : 1 };
  if (has(/\b(towards?|closer|nearer)\b/)) return { v: { x: 0, y: 1 }, depth: -1 };
  if (has(/\baway\b/)) return { v: { x: 0, y: -1 }, depth: 1 };
  if (has(/\b(left|leftwards?)\b/)) return { v: { x: -1, y: 0 }, depth: 0 };
  if (has(/\b(right|rightwards?)\b/)) return { v: { x: 1, y: 0 }, depth: 0 };
  if (has(/\b(up|upwards?|lift(s|ed|ing)?|ris(e|es|ing)|rose|ascend(s|ed|ing)?)\b/)) {
    return { v: { x: 0, y: -1 }, depth: 0 };
  }
  if (
    has(
      /\b(down|downwards?|drop(s|ped|ping)?|fall(s|ing)?|fell|sink(s|ing)?|sank|descend(s|ed|ing)?)\b/,
    )
  ) {
    return { v: { x: 0, y: 1 }, depth: 0 };
  }
  return null;
}

/** "small" / "a quarter of its body length" = 0.08; "noticeable" / "half" = 0.12 (upper bound tested). */
export function amplitudeFor(magnitude: string | null): number {
  const m = (magnitude ?? "").toLowerCase();
  let amp: number = MOTION.defaultAmplitude;
  if (/\b(tiny|barely|slightest)\b/.test(m)) amp = MOTION.minAmplitude;
  else if (/\b(half|noticeabl\w*|large|big|far|long|clearly|full|whole|significant\w*)\b/.test(m)) {
    amp = MOTION.largeAmplitude;
  }
  return Math.min(MOTION.maxAmplitude, Math.max(MOTION.minAmplitude, amp));
}

/** Seconds in the timing text when present, else quick/slow words, clamped to the tested range. */
export function durationFor(timing: string | null, action = ""): number {
  const t = `${timing ?? ""} ${action}`.toLowerCase();
  const secs = /(\d+(?:\.\d+)?)\s*(?:s\b|sec\w*)/.exec(t);
  const ms = /(\d+)\s*ms\b/.exec(t);
  let dur: number = MOTION.defaultDurMs;
  if (ms?.[1]) dur = Number(ms[1]);
  else if (secs?.[1]) dur = Number(secs[1]) * 1000;
  else if (/\bhalf a second\b/.test(t)) dur = 500;
  else if (/\b(quick\w*|sudden\w*|jerk\w*|fast|snap\w*|abrupt\w*|lurch\w*|instant\w*)\b/.test(t)) {
    dur = MOTION.minDurMs;
  } else if (/\b(slow\w*|gradual\w*|gentl\w*)\b/.test(t)) dur = MOTION.maxDurMs;
  return Math.min(MOTION.maxDurMs, Math.max(MOTION.minDurMs, dur));
}

/**
 * Maps plan.selectedAction to a motion program for a product whose region is known.
 * Returns null (static still, the pre-sketch behaviour) when the region is unknown, the action is
 * not a translation of the whole product (rotation, a light, a part opening, a person's step), the
 * travel is negated ("does not move", "stops moving") or no direction is stated. A missing
 * direction is never guessed: that would show a move the customer did not report.
 */
export function buildMotionProgram(
  action: SelectedAction | null,
  region: ProductRegion | null,
  purpose: Purpose = "problem",
): MotionProgram | null {
  if (!action || !region) return null;
  const verb = action.action.toLowerCase();
  const travels = affirmed(verb, TRAVEL);
  // Without a direction field the action text needs its own non-negated travel verb.
  if (!travels && (action.direction === null || TRAVEL.test(verb) || NON_TRANSLATION.test(verb))) {
    return null;
  }
  // The direction field wins; the action text is read only when the planner left direction null.
  const heading = headingFor((action.direction ?? action.action).toLowerCase(), region.forward);
  if (!heading) return null;
  const { v, depth } = heading;

  const reps = Math.min(MOTION.maxRepetitions, Math.max(1, action.repetitions ?? 1));
  // A support demonstration has to read on camera. "A short way" in a procedure is the real-world
  // distance; at the default amplitude X2 moved the vacuum ~3% of the frame and the critic saw it
  // as standing still. A customer's report keeps the size they described.
  const amplitude = purpose === "solution" ? MOTION.largeAmplitude : amplitudeFor(action.magnitude);
  const total = Math.min(MOTION.maxAmplitude, amplitude * reps);
  const dur = durationFor(action.timing, action.action);
  const segments: MotionSegment[] = [];
  for (let i = 0; i < reps; i += 1) {
    segments.push({
      startMs: MOTION.delayMs + i * (dur + MOTION.holdBetweenMs),
      durMs: dur,
      from: i / reps,
      to: (i + 1) / reps,
    });
  }
  const scaleDelta = total * MOTION.scalePerAmplitude * depth;
  return {
    dx: round4(total * v.x),
    dy: round4(total * v.y),
    endScale: round4(1 - scaleDelta),
    segments,
    pointer: true,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000 + 0; // + 0 normalizes -0
}

export function easeInOutQuad(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/** Path progress (0..1) at `elapsedMs` after the run's first real output frame. */
export function progressAt(program: MotionProgram, elapsedMs: number): number {
  let p = 0;
  for (const seg of program.segments) {
    if (elapsedMs < seg.startMs) break;
    p = seg.from + (seg.to - seg.from) * easeInOutQuad((elapsedMs - seg.startMs) / seg.durMs);
  }
  return p;
}

/** Last moment the program changes the pose (after this it only holds). */
export function programEndMs(program: MotionProgram): number {
  return program.segments.reduce((end, s) => Math.max(end, s.startMs + s.durMs), 0);
}

export interface PointerSample {
  atMs: number;
  x: number;
  y: number;
  active: boolean;
}

/**
 * Pointer path in output-normalized coordinates: starts at the product centre (raised by 4% of the
 * box height), follows the same eased path in `pointerSteps` sends per segment, and releases
 * (active:false) at the end point 150 ms after the last move.
 */
export function pointerSchedule(
  program: MotionProgram,
  centerInFrame: { x: number; y: number },
  boxHeightInFrame: number,
): PointerSample[] {
  if (!program.pointer || program.segments.length === 0) return [];
  const sx = centerInFrame.x;
  const sy = centerInFrame.y - 0.04 * boxHeightInFrame;
  const at = (p: number) => ({ x: clamp01(sx + program.dx * p), y: clamp01(sy + program.dy * p) });
  const out: PointerSample[] = [];
  for (const seg of program.segments) {
    for (let i = 0; i <= MOTION.pointerSteps; i += 1) {
      const t = i / MOTION.pointerSteps;
      const p = seg.from + (seg.to - seg.from) * easeInOutQuad(t);
      out.push({ atMs: Math.round(seg.startMs + t * seg.durMs), ...at(p), active: true });
    }
  }
  out.push({ atMs: programEndMs(program) + MOTION.pointerReleaseMs, ...at(1), active: false });
  return out;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Pose of the product at path progress p: frame-fraction offset and scale about its centre. */
export function poseAt(
  program: MotionProgram,
  p: number,
): { dx: number; dy: number; scale: number } {
  return { dx: program.dx * p + 0, dy: program.dy * p + 0, scale: 1 + (program.endScale - 1) * p };
}

/**
 * The robot-vacuum demo still (assets/demo/demo-vacuum.jpg, 1600x1067), measured in the motion lab:
 * the vacuum's front (side brush + bumper) points screen-left and slightly toward the camera.
 */
export const DEMO_VACUUM_REGION: ProductRegion = (() => {
  const W = 1600;
  const H = 1067;
  const e = (cx: number, cy: number, rx: number, ry: number): MaskEllipse => ({
    kind: "ellipse",
    cx: cx / W,
    cy: cy / H,
    rx: rx / W,
    ry: ry / H,
  });
  const r = (x: number, y: number, w: number, h: number): MaskRect => ({
    kind: "rect",
    x: x / W,
    y: y / H,
    w: w / W,
    h: h / H,
  });
  return {
    mask: [e(877, 700, 342, 116), r(535, 700, 684, 150), e(877, 850, 340, 78), e(515, 790, 34, 22)],
    center: { x: 877 / W, y: 757 / H },
    box: r(480, 585, 742, 343),
    cleanPlate: r(0, 585, 470, 360),
    forward: { x: -1, y: MOTION.minorAxis },
  };
})();
