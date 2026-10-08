# SymptomSketch

## DEMO SCRIPT

Open on the live Reactor X2 stage. Build the case before the judges arrive, then run the
on-stage part in about 20 seconds.

Before (about 1 minute, off stage):

1. Open the deployed URL (or `pnpm install && pnpm dev`, then http://127.0.0.1:5173).
2. Pick Robot vacuum and enter the demo access code. The Issue box is prefilled with the demo's
   example, "It stops, then jerks backward once." Press Continue to Recreate; Gemini writes the
   movement plan.
3. Press Start preview. The stage badge reads "Live · Reactor X2" and the stage takes the full
   width. Leave it running: generation is continuous while the stage is live.

On stage (about 20 seconds; the re-plan time depends on Gemini):

1. 0 s: point at the stage. Every moving frame is Reactor X2, streamed from the product photo and
   steered by the compiled plan. The Reactor X2 readout under the stage shows uptime, round trip,
   "Gemini planned in" and "X2 accepted prompt in".
2. 3 s: steer it live. Type "the backward jerk is smaller and quicker" in Refine the movement and
   press Update preview; X2 changes the motion without restarting the stream.
3. About 10 s: once the corrected movement is on stage, the clip button counts down ("Clip in N s")
   for 5 s, then reads "Clip last N s". Press it when the stage shows the jerk. It saves the last 5
   to 11 seconds of the live X2 stream as an MP4, ending at the click, so you capture the moment
   after it happens. The preview keeps generating.
4. About 14 s: the Gemini critic checks that exact MP4 against the plan (matches, uncertain or
   needs_revision). Accept it.
5. About 18 s: Support tab, Send to Demo Support. In a second browser profile, `/support` shows the
   ticket with the clip; a text reply appears in the customer's Support tab.

## What it is

A live Reactor X2 world-model reenactment of what your product did, for product support. Reactor
X2 takes one photo of the product and generates a real-time, steerable video of it doing the thing
the customer describes; corrections in plain words steer the running stream. Gemini plans before
(it turns the customer's words into an explicit action plan and the X2 prompt) and checks after
(it compares the finished clip to that plan). Every moving frame on the stage and in the MP4 comes
from X2. Generation runs continuously while the stage is live, and the customer clips the moment
they want, approves the exact file, and sends it to support.

## Setup

Requirements: Node 24+, pnpm 10.33 (`corepack enable`), ffmpeg and ffprobe on `PATH` (or set
`FFMPEG_PATH` / `FFPROBE_PATH`). Built and verified on Windows 11 with Node 24.14, pnpm 10.33 and
ffmpeg 8.1.

```sh
pnpm install
cp .env.example .env    # then fill in the values (never commit .env)
pnpm dev                # API on :3030, Vite on http://127.0.0.1:5173 (proxies /api)
```

Environment variables (root `.env`, read by `apps/server/src/config.ts`; names only):

| Name                                                             | Purpose                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `REACTOR_API_KEY`                                                | Server-side key; the browser only gets short-lived X2 JWTs             |
| `GEMINI_API_KEY`                                                 | Planner and critic                                                     |
| `DEMO_ACCESS_CODE`                                               | Code a customer enters before a case is created                        |
| `DEMO_SUPPORT_CODE`                                              | Code for the `/support` workspace                                      |
| `SESSION_SECRET`                                                 | Signs the `ss_session` cookie (random per boot if unset)               |
| `PORT`, `DATA_DIR`, `APP_ORIGIN`                                 | API port (3030), data folder (`./.data`), allowed origins (comma list) |
| `GEMINI_TEXT_MODEL`, `GEMINI_CRITIC_MODEL`, `GEMINI_IMAGE_MODEL` | Model overrides                                                        |
| `GEMINI_THINKING_LEVEL`, `CRITIC_FPS`                            | Planner effort, critic sampling rate                                   |
| `MAX_LIVE_SESSIONS`, `MAX_EXPORT_JOBS`, `CASE_RETENTION_DAYS`    | Capacity and retention limits                                          |
| `ENABLE_EXTENDED_INPUTS`, `FFMPEG_PATH`, `FFPROBE_PATH`          | Optional inputs and tool paths                                         |

Gates (all must pass before a commit): `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
`pnpm format` fixes prettier drift. A real-provider API smoke runs against a live server with
`pnpm exec tsx scripts/smoke-api.ts` (set `SMOKE_BASE_URL` for a non-default port).

Versions: React 19, Vite 8, Tailwind 4, Express 5, TypeScript 6, `@reactor-models/x2` 1.x
(`@reactor-team/js-sdk` wasm shipped under `dist/assets/wasm`), `@google/genai` 2.x, sharp 0.35,
SQLite through `node:sqlite`.

## Demo flow

Customer:

1. Landing, choose Robot vacuum (or upload a photo), enter the demo access code.
2. Issue: describe what happened in your own words (demo products start from an editable example).
   Gemini builds a movement plan (direction, count, timing) and lists what is still unclear.
3. Recreate: Start preview opens a live Reactor X2 session and the stage takes the full width. The
   stream keeps generating while it is live. Refine in plain words; Update preview steers it.
4. Clip last N s saves the last 5 to 11 s of the live X2 stream as an MP4, ending at the click,
   without stopping the preview. The Gemini critic checks the exact file against the plan and
   returns matches, uncertain or needs_revision with a suggested correction.
5. Accept the take (a note is required when the critic could not verify it), then send it from the
   Support tab. Support replies show up in the same tab.

Support:

1. `/support`, enter the support code. The inbox lists tickets.
2. Open a ticket and play the customer's clip, then open the work case.
3. Show the solution: a solution plan, live preview and a clipped take, reviewed the same way.
4. Reply with text and the take; the customer sees it in their Support tab.

## How the motion is generated

Every moving frame comes from Reactor X2. The server compiles the Gemini plan into an X2 prompt, and
the browser streams the product photo to X2 as its source. For the robot vacuum demo photo the app
also animates that source (a motion sketch): the vacuum is cut out, the hole is covered with a
clean plate of rug, and the cutout slides along the planned direction while `setPointer` follows
the same path. X2 renders the result; the sketch only guides it. Lab results and the full mechanism
are in `docs/providers/reactor-x2.md` section 9. Nothing on screen is a stock clip or fixture.

## Known limitations

- The motion sketch only runs for the robot vacuum demo photo, the one still with a measured product
  region. Uploaded photos and the fan and drone demos use the prompt alone, which tends to give
  in-place changes rather than travel.
- Rotations, lights and parts opening get no sketch. The live output trails the source by 1 to 3 s
  and often moves as a creep followed by a step.
- The critic often returns uncertain when the clip starts at rest (it cannot see the "after
  stopping" part), so accepting usually needs a review note.
- Support demonstration takes (solution mode): the sketch now moves the vacuum about 12% of the
  frame, and the critic gets the clip's first and last stills at full size, so it sees the move
  (critic-v1 called the same clip motionless). X2 still sometimes adds artifacts, such as a second
  vacuum body appearing behind the moved one, and the critic flags those as needs_revision, which
  blocks accept. Clip again, or answer with a text reply.
- A small dark sliver of the side brush can stay on the rug behind the moved vacuum.
- The server caps one X2 session at 5 minutes, so the live preview switches to a fresh session
  about every 4:40 and shows "Reconnecting to Reactor X2" for a few seconds. A tab hidden for 2
  minutes stops the preview.
- Generated clips illustrate what the customer describes. They do not diagnose a fault. Demo
  Support is hosted inside SymptomSketch; no manufacturer is contacted.
