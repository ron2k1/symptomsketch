# Reactor X2 provider facts (verified live 2026-10-08, ~03:30-05:00 ET)

Checked with real token mints and real X2 sessions on this project's key, using
`@reactor-models/x2@1.0.0` (model `xmax/x2`, `MODEL_VERSION` `v1.0.0`) on top of
`@reactor-team/js-sdk@3.1.0`. Type facts come from `apps/web/node_modules/@reactor-models/x2/dist/{core,react}.d.ts`
and the js-sdk `dist/index.d.ts`. Anything marked "not verified" was read, not run.

The live browser harness that proved this lives at `apps/web/tmp/reactor-spike/` (gitignored, not
part of the app). It is reproducible with `SPIKE_LIVE=1`, which turns on a dev-only `/spike-token` route.

## 1. Token (server, done)

Adapter: `apps/server/src/providers/reactor-token.ts`. Routes call it; nothing else talks to
`api.reactor.inc`.

```ts
import { mintX2Token, ReactorTokenError } from "../providers/reactor-token.ts";
import { AppError } from "../http/errors.ts";

// routes/reactor.ts (server-ai), after the lease is acquired:
try {
  const token = await mintX2Token({
    apiKey: ctx.config.reactorApiKey ?? undefined,
    maxSessions: 1,
  });
  res.setHeader("Cache-Control", "no-store");
  // ReactorTokenResponse: { jwt, expiresAt: token.expiresAt, leaseId, leaseExpiresAt, reactorPrompt }
} catch (err) {
  if (err instanceof ReactorTokenError) throw new AppError(err.code); // never log err beyond code/status
  throw err;
}
```

- Wire call: `POST https://api.reactor.inc/tokens`, header `Reactor-API-Key`, body
  `{expires_after, authorization_details:[{type:"session", resources:{models:{match:["xmax/x2"]}}, constraints:{max_sessions, max_session_duration_seconds}}]}`.
  Response `{jwt, expires_at (Unix seconds), authorization_details}`.
- Lifetime is set by `expires_after`, in seconds: the default is 1 h and the ceiling is 6 h. There is no
  `ttl` field. The adapter requests 900 s, and the provider granted 899 s left at receipt. The JWT
  must outlive the whole session, because the SDK re-sends it on uploads and renegotiation, and a
  token cannot be topped up.
- `max_session_duration_seconds` is a provider-side hard stop. The adapter defaults it to 600 s, which
  covers the spec's 5-minute target plus slack.
- `max_sessions` counts sessions ever created, not concurrent ones. With 1, after `disconnect()` the same
  JWT fails `connect()` with `UNAUTHORIZED` (403). **One token = one connection.** Mint a new token
  for every new connection.
- Error mapping (`err.code` is already a contract `ErrorCode`):

| Cause                                                | `code`                | `reason`                                                  |
| ---------------------------------------------------- | --------------------- | --------------------------------------------------------- |
| key missing/blank (no request sent)                  | `CONFIG_MISSING`      | `missing_api_key`                                         |
| 401/403 (key rejected)                               | `CONFIG_MISSING`      | `rejected_api_key` (live: bogus key -> 401)               |
| 429                                                  | `RATE_LIMITED`        | `rate_limited` (+ `retryAfterMs`)                         |
| other HTTP, network, timeout (10 s), abort, bad JSON | `REACTOR_UNAVAILABLE` | `http_error`/`network`/`timeout`/`aborted`/`bad_response` |

The adapter never reads a non-2xx body and never logs. `err.message` holds only the reason and the
status.

## 2. Vite must ship the SDK's wasm (BLOCKER for the browser, owner: architect)

js-sdk 3.1 loads its client with `import("./wasm/reactor_wasm.js")`, which then fetches
`reactor_wasm_bg.wasm` relative to `import.meta.url`. With the current `apps/web/vite.config.ts`
this breaks two ways:

- **Dev:** dep pre-bundling moves the import to `.vite/deps/wasm/...`, which returns 404, so `connect()`
  fails with "reactor-wasm failed to load".
- **Build:** the import is left as-is and no wasm is emitted, so production fails the same way.

Verified fix: with it, a fake JWT reaches the server and gets `UNAUTHORIZED` 401 in both dev and
`vite build` + preview. The build emits `dist/assets/wasm/reactor_wasm.js` (59,549 B) and
`reactor_wasm_bg.wasm` (690,855 B). `app.ts` already serves `dist/assets`, so no server change is
needed.

```ts
// apps/web/vite.config.ts additions
import fs from "node:fs";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

function reactorWasmDir(): string {
  // pnpm keeps @reactor-team/js-sdk out of apps/web; reach it through @reactor-models/x2.
  const x2Entry = createRequire(path.join(here, "package.json")).resolve("@reactor-models/x2");
  const sdkEntry = createRequire(x2Entry).resolve("@reactor-team/js-sdk");
  return path.join(path.dirname(sdkEntry), "wasm");
}
function reactorWasmAssets(): Plugin {
  const dir = reactorWasmDir();
  return {
    name: "reactor-wasm-assets",
    apply: "build",
    generateBundle() {
      for (const file of ["reactor_wasm.js", "reactor_wasm_bg.wasm"]) {
        const source = fs.readFileSync(path.join(dir, file));
        this.emitFile({ type: "asset", fileName: `assets/wasm/${file}`, source });
      }
    },
  };
}
// in defineConfig:
//   plugins: [react(), tailwindcss(), reactorWasmAssets()],
//   optimizeDeps: {
//     exclude: ["@reactor-models/x2", "@reactor-team/js-sdk"],
//     // excluded ESM imports CJS deps directly; pre-bundle them or React's named exports break
//     include: ["react", "react/jsx-runtime", "@reactor-models/x2 > @reactor-team/js-sdk > awaitqueue"],
//   },
```

## 3. Imports

| Need                                             | Import                                                                                                                                                                                                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Imperative client (no React)                     | `import { X2Model } from "@reactor-models/x2/core"`                                                                                                                                                                                                                                 |
| Message/param types                              | `X2StateUpdateMessage`, `X2GenerationStartedMessage`, `X2GenerationStoppedMessage`, `X2PromptAcceptedMessage`, `X2ReferenceImageAcceptedMessage`, `X2PointerChangedMessage`, `X2Message`, `FileRef` from `@reactor-models/x2/core`                                                  |
| React wrappers                                   | `X2Provider`, `useX2`, `useX2StateUpdate`, `useX2GenerationStarted`, `useX2GenerationStopped`, `useX2PromptAccepted`, `useX2ReferenceImageAccepted`, `useX2PointerChanged`, `useX2Message`, `useX2Track`, `X2MainVideoView`, `X2SourceView` from `@reactor-models/x2` (or `/react`) |
| Base SDK types (`ReactorStatus`, `ReactorError`) | not importable from apps/web, because the js-sdk is not a direct dependency. Derive them: `ReturnType<X2Model["getStatus"]>`, `NonNullable<ReturnType<X2Model["getLastError"]>>`                                                                                                    |

Recommendation: use `X2Model` directly inside one hook in `features/preview`, as the snippet in section 7
does. `X2Provider` props are live: any change to `jwtToken`, `connectOptions` or `modelTracks` tears down
the session and rebuilds it. That spends the single-session token. `X2SourceView` publishes a webcam,
which is the wrong source for this app.

## 4. Status values

`ReactorStatus = "disconnected" | "connecting" | "waiting" | "ready"`. These are emitted through
`x2.on("statusChanged", s)` and read with `x2.getStatus()`.

- `connect(jwt)` moves `connecting` -> `waiting` -> `ready` and resolves at `ready`. It throws if the status is not
  `disconnected`.
- `main_video` (`onMainVideo`) fired about 100 ms before `ready`.
- `disconnect(recoverable = false)` ends the session server-side and frees the wasm client.
- `reconnect()` rebuilds the transport on the same session (not verified).

## 5. Messages (from core.d.ts, all observed live except where noted)

Subscribe with `x2.onStateUpdate(h)` and the other `onX(h)` methods; each returns an unsubscribe function. The handler gets the
unwrapped payload. The raw `x2.on("message", h)` handler gets a `{type, data}` envelope instead, so use the typed ones.

| `type`                     | Payload                                                                                                                                                  | When                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `state_update`             | `{width: number\|null, height: number\|null, prompt: string\|null, pointer_x, pointer_y, generating, keep_backlog, pointer_active, has_reference_image}` | after every state change (see contradiction C2)                                         |
| `prompt_accepted`          | `{prompt}`                                                                                                                                               | reply to `setPrompt`                                                                    |
| `generation_started`       | `{width, height, prompt, has_reference_image}`                                                                                                           | ~28 ms after `prompt_accepted` on the first non-empty prompt                            |
| `generation_stopped`       | `{reason: "reset" \| "reference_image_changed"}` (typed `string`)                                                                                        | after `reset()`, or when the reference is replaced mid-run (that case was not verified) |
| `reference_image_accepted` | `{width, height}` of the decoded upload (live: 1600x1067)                                                                                                | reply to `setReferenceImage`                                                            |
| `pointer_changed`          | `{x, y, active}`                                                                                                                                         | reply to `setPointer`                                                                   |

The platform scope arrives on `x2.on("runtimeMessage", m)` as `{type, data}`. Two values matter here:

- `"modelSchema"` arrives on connect; ignore it.
- `"moderation"` carries `{action: "warn" | "terminate", input_kind: "text" | "image", command, categories: string[], message}`. A `terminate` action ends the session shortly after.

## 6. Errors

All failures are `ReactorError` instances, with `name === "ReactorError"` live. Fields:

- `code`: string;
- `recoverable`: boolean;
- `status`: HTTP status or `undefined`;
- `operation`: e.g. `"connect"`, `"sendCommand"`;
- `retry_after_ms`;
- `timestamp_ms`.

Match on `code`, not on the class.

- **Throw:** `connect()`, `publishSource()` and `uploadFile()`.
- **Never reject:** `sendCommand` and every typed command (`setPrompt`, `setReferenceImage`, `reset`, `setKeepBacklog`,
  `setPointer`, ...). They resolve `undefined` on failure, emit `x2.on("error", e)`, and set `getLastError()`.
  `unpublishSource()` never rejects either.
- **Live example:** a 1001-char prompt made `setPrompt` resolve `undefined`. It produced `error`
  `{code:"invalid_command", recoverable:false, operation:"sendCommand"}`, with a message naming
  `max_length(1000)`. The session kept working despite `recoverable:false`. Enforce
  `LIMITS.reactorPromptMaxChars` (1000) on the server.
- **Model command codes:** `invalid_command`, and `invalid_image` for an undecodable reference
  (the latter from the d.ts, not verified).
- **Platform codes:** `UNAUTHORIZED` (401/403; live: reused token after disconnect gives 403), `NETWORK_ERROR`, `NOT_FOUND`,
  `CONFLICT`, `RATE_LIMITED`, `BAD_REQUEST`, `SERVER_ERROR`, `VERSION_MISMATCH`, `DECODE_FAILED`,
  `INVALID_STATE` (command before ready), `SESSION_TERMINAL`, `MESSAGE_TOO_LARGE`, `TRANSPORT_ERROR`,
  `DISCONNECTED`, `REQUEST_TIMEOUT`, `ABORTED`, `RECORDER_DISABLED`.
- **UI mapping:** map these to the contract's `REACTOR_UNAVAILABLE` for display. Never render
  `e.message` raw.

## 7. Lifecycle snippet (verified live end to end, typecheck-clean under apps/web tsconfig)

```ts
import { X2Model, type X2StateUpdateMessage } from "@reactor-models/x2/core";

type ReactorStatus = ReturnType<X2Model["getStatus"]>;
type ReactorError = NonNullable<ReturnType<X2Model["getLastError"]>>;
type RawMessage = { type: string; data: unknown };

// 1280x720 = LIMITS.sourceCanvasWidth/Height. 24 fps source repaint.
const SOURCE_W = 1280;
const SOURCE_H = 720;
const SOURCE_FPS = 24;

export interface X2PreviewHandlers {
  onStatus?: (status: ReactorStatus) => void;
  onState?: (state: X2StateUpdateMessage) => void;
  /** Fired once per run when the first NEW decoded output frame is presented. */
  onFirstFreshFrame?: (runId: number, at: DOMHighResTimeStamp) => void;
  onGenerationStopped?: (reason: string) => void;
  /** Every failure incl. command errors (sendCommand never rejects). */
  onError?: (err: { code: string; recoverable: boolean; operation?: string }) => void;
  /** "terminate" ends the session shortly after. */
  onModeration?: (action: "warn" | "terminate") => void;
}

/** Product still letterboxed onto a fixed 16:9 canvas, repainted at 24 fps. */
export function createStillSource(img: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = SOURCE_W;
  canvas.height = SOURCE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");

  const cover = Math.max(SOURCE_W / img.naturalWidth, SOURCE_H / img.naturalHeight);
  const contain = Math.min(SOURCE_W / img.naturalWidth, SOURCE_H / img.naturalHeight);
  const draw = () => {
    // Backdrop: same photo cover-scaled + blurred, so there are no hard bars for the model to "edit".
    ctx.filter = "blur(24px) brightness(0.6)";
    const cw = img.naturalWidth * cover;
    const ch = img.naturalHeight * cover;
    ctx.drawImage(img, (SOURCE_W - cw) / 2, (SOURCE_H - ch) / 2, cw, ch);
    ctx.filter = "none";
    // Foreground: the whole product, never cropped.
    const w = img.naturalWidth * contain;
    const h = img.naturalHeight * contain;
    ctx.drawImage(img, (SOURCE_W - w) / 2, (SOURCE_H - h) / 2, w, h);
  };
  draw();

  const track = canvas.captureStream(SOURCE_FPS).getVideoTracks()[0];
  if (!track) throw new Error("captureStream produced no video track");
  track.contentHint = "detail"; // hold resolution, trade framerate
  const timer = setInterval(draw, 1000 / SOURCE_FPS); // captureStream only emits on repaint
  return {
    canvas,
    track,
    stop() {
      clearInterval(timer);
      track.stop();
    },
  };
}

export class X2Preview {
  readonly x2 = new X2Model();
  private source: ReturnType<typeof createStillSource> | null = null;
  private unsubs: Array<() => void> = [];
  private readonly video: HTMLVideoElement;
  private readonly h: X2PreviewHandlers;
  private runId = 0;
  private armedRun = 0;
  private lastMediaTime = -1;
  private mediaTimeAtArm = -1;
  private sawFresh = false;
  private frameHandle: number | null = null;

  constructor(video: HTMLVideoElement, h: X2PreviewHandlers = {}) {
    this.video = video;
    this.h = h;
    const { x2 } = this;
    const status = (s: ReactorStatus) => h.onStatus?.(s);
    const error = (e: ReactorError) =>
      h.onError?.({ code: e.code, recoverable: e.recoverable, operation: e.operation });
    const runtime = (m: RawMessage) => {
      if (m.type !== "moderation") return;
      const action = (m.data as { action?: unknown } | null)?.action;
      if (action === "warn" || action === "terminate") h.onModeration?.(action);
    };
    x2.on("statusChanged", status);
    x2.on("error", error);
    x2.on("runtimeMessage", runtime);
    this.unsubs.push(
      () => x2.off("statusChanged", status),
      () => x2.off("error", error),
      () => x2.off("runtimeMessage", runtime),
      x2.onStateUpdate((m) => h.onState?.(m)),
      x2.onGenerationStarted(() => this.arm()),
      x2.onGenerationStopped((m) => h.onGenerationStopped?.(m.reason)),
      x2.onMainVideo((_track, stream) => {
        video.srcObject = stream;
        video.muted = true;
        void video.play().catch(() => undefined);
        this.watchFrames();
      }),
    );
  }

  /** jwt: the static string from POST /api/cases/:id/reactor-token. Resolves at "ready". */
  async connect(jwt: string, productPhoto: HTMLImageElement): Promise<void> {
    await this.x2.connect(jwt); // throws ReactorError (e.g. UNAUTHORIZED 401/403)
    if (this.x2.getStatus() !== "ready")
      throw new Error(`unexpected status ${this.x2.getStatus()}`);
    this.source = createStillSource(productPhoto);
    await this.x2.publishSource(this.source.track); // throws on failure
    await this.x2.setKeepBacklog({ keep_backlog: true }); // still mode; persists across reset
  }

  /** Reference first, then a non-empty prompt starts generation (~30 ms later). */
  async startRun(reference: Blob, prompt: string): Promise<number> {
    const ref = await this.x2.uploadFile(reference, { name: "reference.jpg" }); // throws
    const accepted = await this.x2.setReferenceImage({ reference_image: ref });
    if (!accepted) throw new Error("reference rejected (see onError, e.g. invalid_image)");
    this.runId += 1;
    const ack = await this.x2.setPrompt({ prompt });
    if (!ack) throw new Error("prompt rejected (see onError, e.g. invalid_command)");
    return this.runId;
  }

  /** Correction mid-run: applies from the next block, no restart. Serialize calls. */
  async correct(prompt: string): Promise<boolean> {
    return (await this.x2.setPrompt({ prompt })) !== undefined;
  }

  /** Stops generation, keeps the session (same token, same connection). Output freezes. */
  async reset(): Promise<void> {
    this.armedRun = 0;
    await this.x2.reset();
  }

  /** Full teardown. Session ends server-side; next connect needs a NEW token + new X2Preview. */
  async close(): Promise<void> {
    if (this.frameHandle !== null) this.video.cancelVideoFrameCallback(this.frameHandle);
    this.frameHandle = null;
    try {
      if (this.x2.getStatus() === "ready") await this.x2.unpublishSource(); // never rejects
      await this.x2.disconnect(); // non-recoverable: ends session + frees wasm client
    } finally {
      this.source?.stop();
      this.source = null;
      this.video.pause();
      this.video.srcObject = null;
      for (const off of this.unsubs.splice(0)) off();
    }
  }

  private arm() {
    // No frames flow between reset and the next generation_started, so any frame with a newer
    // mediaTime than the last pre-arm frame belongs to this run.
    this.armedRun = this.runId;
    this.sawFresh = false;
    this.mediaTimeAtArm = this.lastMediaTime;
  }

  private watchFrames() {
    const onFrame: VideoFrameRequestCallback = (now, meta) => {
      if (meta.mediaTime > this.lastMediaTime) {
        this.lastMediaTime = meta.mediaTime;
        if (this.armedRun !== 0 && !this.sawFresh && meta.mediaTime > this.mediaTimeAtArm) {
          this.sawFresh = true;
          this.h.onFirstFreshFrame?.(this.armedRun, now);
        }
      }
      this.frameHandle = this.video.requestVideoFrameCallback(onFrame);
    };
    this.frameHandle = this.video.requestVideoFrameCallback(onFrame);
  }
}
```

Notes for wrapping this in `features/preview`:

- **One instance per connection.** Keep the `X2Preview` in a ref. React StrictMode double-mounts
  effects, so guard against connecting twice: the second `connect` would burn the token.
- **Fresh-frame detection.** It uses `requestVideoFrameCallback` `mediaTime` progress. Re-presenting a
  frozen frame does not advance `mediaTime`, so it never fires falsely. For the recording offset (spec
  12), measure `performance.now()` against the MediaRecorder start at the moment you draw that frame
  onto the recording canvas. Do not use the compositor `now`. The spec's stall rule (2 s,
  `LIMITS.outputStallMs`) uses the same `mediaTime` progress.
- **Output size.** It is chosen at the first generation and fixed for the whole session, surviving
  `reset`. A 1280x720 source produced **1472x832** output. Draw it contain-fit into the 1280x720
  recording canvas.

## 8. Reset, sessions, record next take

- **`reset()` keeps the connection.** It resolves with status still `ready` and emits
  `generation_stopped {reason:"reset"}`. The following `state_update` shows `prompt:null`,
  `has_reference_image:false`, `generating:false` and the pointer cleared. `keep_backlog` stays true and
  width/height stay. The `<video>` freezes on the last frame, and **no new frames arrived in the 2.5 s
  after reset**.
- **The single session survives reset.** Re-applying the reference and a new prompt on the same
  connection restarted generation, with the same `max_sessions:1` token. So spec 12's "documented
  reset" path works, and a new connection is not required to separate old output. A new
  connection costs a new token plus ~5-6 s of connect time.
- **Record next take (spec 12) sequence on the live connection:**
  1. Run `reset()`.
  2. Upload the reference and run `setReferenceImage` (the first half of `startRun`).
  3. Start MediaRecorder on the recording canvas.
  4. Bump the run id and call `setPrompt`; arm happens on `generation_started`.
  5. Use the first fresh frame as the offset.

  So split `startRun` into `prepareRun(reference)` and `fire(prompt)`. Do not change the source track
  while recording.

- **Replacing the reference mid-run** auto-restarts generation (`generation_stopped
{reason:"reference_image_changed"}`, then a new `generation_started`). This is from the d.ts and was not
  verified. The spec's path of reset, then reference, then prompt is the verified one.
- **Cleanup order.** Cancel rVFC, then `unpublishSource()`, then `disconnect()`, then stop the canvas
  track and timer, then detach `<video>`, then unsubscribe. Then release the lease (`preview-lease
release`). Call it on Stop preview, idle (`LIMITS.previewIdleMs`), max (`LIMITS.previewMaxMs`),
  after capture, on unmount and on moderation `terminate`.
- **JWT handling.** Pass the **static JWT string**, never a resolver that mints. The SDK calls a resolver
  before every authenticated request, and a freshly minted token there broke uploads with 403.

## 9. keep_backlog and pointer

- **`setKeepBacklog({keep_backlog:true})`.** The default is false, which drops backlog for low
  latency. True consumes every source frame in order: smoother motion at the cost of growing delay.
  For a static repainted still there is no motion to lag, and it is the documented still and drag
  mode. It worked live and persists across reset.
- **`setPointer({x, y, active})`.** `x` and `y` are 0..1, normalized to the output frame. It is sampled
  once per block and only steers while `active`. It replies `pointer_changed {x,y,active}`, which was
  verified live.
  - Send `active:false` on release; `reset()` also clears the pointer.
  - Split setters exist: `setPointerX({pointer_x})`, `setPointerY({pointer_y})` and
    `setPointerActive({pointer_active})`.
  - Use it only if a directional drag expresses the motion better than the prompt.
  - Its visual effect on motion was not evaluated.

## 10. Observed timings (headless Chromium, home network)

| Step                                      | Observed                                                |
| ----------------------------------------- | ------------------------------------------------------- |
| token mint                                | ~0.2-0.35 s                                             |
| `connect()` to `ready`                    | 4.6-6.5 s (one run: session ~0.47 s, transport ~6.07 s) |
| upload + `reference_image_accepted`       | well under 1 s                                          |
| `prompt_accepted` -> `generation_started` | ~28 ms                                                  |
| `generation_started` -> first fresh frame | 356-370 ms                                              |
| decoded output rate                       | ~18 fps (do not hard-code 24)                           |

The `LIMITS.outputStartDeadlineMs` of 20 s is comfortable once connected. Count connect time separately.

## 11. Contradictions with the task summary and the docs

- **C1. There is no `command_error` message.**
  - It is not in the 1.0.0 `X2Message` union, and none arrived live.
  - Command failures surface as the `error` event (`ReactorError`, e.g. `code:"invalid_command"`), with the typed
    call resolving `undefined`.
  - The `useX2CommandError` hook in the older 0.5.2 reference frontend does not exist in 1.0.0.
- **C2. `state_update` did not arrive on connect.**
  - The d.ts says "Emitted on connect"; live, the first one came only after a later command.
  - Initialize local defaults instead of waiting for it.
- **C3. "main_video at 24 fps".**
  - Decoded ~18 fps in headless Chromium.
- **C4. "Resolution locks from the source".**
  - The output size is chosen at the first generation, is fixed for the whole session (including across
    `reset`), and is not the source size: 1280x720 in gave 1472x832 out.
- **C5. Messages list.**
  - The summary omits `pointer_changed` and lists the nonexistent `command_error`.
- **C6. `reset()` scope.**
  - It also clears the pointer.
  - It keeps `keep_backlog`, the output size and the connection.
- **C7. Token body and lifetime.**
  - The known-good body had no lifetime field, so it got the 1 h default. The field is `expires_after`
    (no `ttl`), with a 6 h ceiling.
  - The x2 README says tokens are valid for 6 h. The auth docs say 1 h default and 6 h max, and live behaviour
    matches the auth docs.
  - README/reference examples use `max_sessions` 5 or 10. The spec's 1 works but forbids reconnecting.
- **C8. Letterbox.**
  - The reference frontend cover-crops the source and says not to letterbox.
  - Per the task, this app letterboxes onto a blurred cover backdrop (no hard bars), and generation ran
    normally. No A/B quality comparison was made.
- **C9. Prop naming.**
  - The reference frontend uses a `getJwt` prop; js-sdk 3.1 `ReactorProvider`/`X2Provider` take
    `jwtToken` (string or resolver).
- **C10. The wasm does not "just work" with Vite.**
  - See section 2; the installed packages need the config change.

## 12. Not verified

- `reconnect()`.
- `requestClip()` / `requestRecording()` (on the `useX2()` store; SDK-side HLS clips).
- Reference replacement mid-run.
- The `invalid_image` code.
- Moderation events.

The app records via canvas + MediaRecorder per spec 12, not via SDK clips.
