# SymptomSketch

## DEMO SCRIPT

1. Open the deployed URL (or `pnpm install && pnpm dev`, then http://127.0.0.1:5173).
2. Pick Robot vacuum, describe "It stops, then jerks backward once", open Recreate, refine, record a
   take, review the checked MP4, send it to Demo Support.
3. In a second browser profile open `/support`, reply with text or a demonstration clip; the
   customer sees it in their Support tab.

## What it is

Visual context for product support. Gemini turns a customer's words into an explicit action plan
and later checks the finished clip against it; Reactor X2 turns the product photo into a moving
reenactment; the person who described it approves the exact file before anyone else sees it.

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
2. Issue: describe what happened in your own words. Gemini builds a movement plan (direction, count,
   timing) and lists what is still unclear.
3. Recreate: Start preview opens a live Reactor X2 session. Refine in plain words; Update preview
   applies the correction.
4. Record next take saves about 8 s of generated output as an MP4. The Gemini critic checks the exact
   file against the plan and returns matches, uncertain or needs_revision with a suggested
   correction.
5. Accept the take (a note is required when the critic could not verify it), then send it from the
   Support tab. Support replies show up in the same tab.

Support:

1. `/support`, enter the support code. The inbox lists tickets.
2. Open a ticket and play the customer's clip, then open the work case.
3. Show the solution: a solution plan, live preview and recorded take, reviewed the same way.
4. Reply with text and the take; the customer sees it in their Support tab.

## How the motion is generated

Every moving frame comes from Reactor X2. The server compiles the Gemini plan into an X2 prompt, and
the browser streams the product photo to X2 as its source. For the robot vacuum demo photo the app
also animates that source (a motion sketch): the vacuum is cut out, the hole is covered with a
clean plate of rug, and the cutout slides along the planned direction while `setPointer` follows
the same path. X2 renders the result; the sketch only guides it. Lab results and the full mechanism
are in `docs/providers/reactor-x2.md` section 9. Nothing on screen is a stock clip or fixture.

## Story mode (Interactive Narrative)

A second way to show what happened: the customer tells it as a short story with sound and steers it
scene by scene. MiniMax FastH3 on Reactor renders every scene (text and image to video with
synchronized audio). Gemini acts as the story director: from the real case (product, account, what
was tried, the product photo) it writes the opening scene and, after every scene, three different
things that could have happened next, each with a full FastH3 prompt that names the product's sound.
All three are queued on FastH3 at once as branches that continue from the clip on screen, so a pick
that is already built plays at once. Free text works too. The story follows three acts (setup, what
went wrong, the moment it failed), offers to end after three scenes and stops at six.

The browser records exactly what played (video and generated sound, webm) and can send it to
support with the scene list and the last frame. It lands on the case's ticket; a story sent before
the case has a ticket waits on the case and shows on the ticket once it is sent from the Support
tab. Staff see it on the ticket as "Customer story (MiniMax FastH3)". Nothing is canned: every
scene, choice and caption is a live Gemini call and every clip a live FastH3 call; a failure shows
an error with Retry, never a substitute. Provider facts and measured timings:
`docs/providers/reactor-fast-h3.md`.

Support can answer in kind with **Write the ending** under the story on the ticket: they type the
fix in plain words, Gemini turns it into one or two scenes, and a new FastH3 session plays them
starting from the last frame of the customer's story (scene 1 opens from that frame, scene 2
continues from scene 1). Only support can call it; the ending plays and is recorded in the staff
browser for a replay.

Two-minute demo script:

1. (0:00) Open a robot vacuum case whose account is filled in and that was already sent to Demo
   Support. On the Issue tab click **Tell it as a story**.
2. (0:05) Click **Start the story**. Point at the queue strip on the right: the opening clip is
   queued from the case's own photo, then builds. It plays about 20 s after the click, with sound.
3. (0:25) Three choice cards appear, each showing Queued, Building or Ready and its FastH3 clip id.
   Pick one that is still building: it jumps to the front and plays about 5 s later; the other two
   turn "popped" in the strip.
4. (0:35) Pick a card that says Ready: it plays in under half a second. The readout shows build
   time, pick to play (built vs. building) and director latency, all measured live.
5. (0:45) Type your own beat in **Something else happened? Say it in your words.** and click
   **Show this instead**.
6. (0:55) Click **That's what happened**, then **Send this story to support**.
7. (1:05) In the support browser open the ticket: the "Customer story (MiniMax FastH3)" section has
   the reel and every scene with the choices offered, the typed beat and the exact FastH3 prompt.
8. (1:20) Under it, type the fix in **How to fix it** and click **Write the ending**. Gemini writes
   it in about 4 s, the first ending scene plays from the story's last frame about 11 s after the
   click, the second follows, and the recorded ending is ready to replay about 25 s after the click.

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
  blocks accept. Record another take, or answer with a text reply.
- A small dark sliver of the side brush can stay on the rug behind the moved vacuum.
- Generated clips illustrate what the customer describes. They do not diagnose a fault. Demo
  Support is hosted inside SymptomSketch; no manufacturer is contacted.
