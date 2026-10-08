# Reactor Vidu S2 Avatar facts (verified live 2026-10-08, ~11:50-12:00 ET)

Checked with two real calls on this project's keys through the installed
`@reactor-models/vidu-s2-avatar@0.5.0` on `@reactor-team/js-sdk@3.1.0` (read
`node_modules/@reactor-models/vidu-s2-avatar/dist/core.d.ts` before changing a call). Anything not
exercised live says "not verified".

## What it is used for

The customer's Support tab offers "Talk to support now" once a ticket exists: a live video call
with Sam, a fictional, clearly-AI support agent who already knows the ticket. Reactor X2 stays the
model that makes the reenactment clips; Vidu S2 Avatar is only this call. Code:

| Piece                                   | Where                                                      |
| --------------------------------------- | ---------------------------------------------------------- |
| Token, brief, portrait, avatar id, logs | `apps/server/src/support/call-routes.ts`                   |
| Gemini call brief (persona + greeting)  | `apps/server/src/support/call-brief.ts`                    |
| Nano Banana portrait + composite        | `apps/server/src/support/call-portrait.ts`                 |
| Stored transcripts                      | `apps/server/src/support/call-transcripts.ts`              |
| Browser call (SDK)                      | `apps/web/src/features/support/support-call-controller.ts` |
| Call UI / staff transcript view         | `SupportCall.tsx` / `CallTranscripts.tsx` (same folder)    |
| Background avatar prep (first call)     | `sam-prep.ts` / `useSamPrep.ts` (same folder)              |

## Token

- `POST https://api.reactor.inc/tokens` with the server key, scoped to the model resource
  `reactor/vidu-s2-avatar`, `max_sessions: 1`, expiry 600 s, max session duration 300 s
  (`LIMITS.supportCall*`). The browser gets it from `POST /api/tickets/:id/support-call/token`
  (owner customer or Demo Support only, 10 per hour per session, `Cache-Control: no-store`). The JWT
  is never logged.
- The same minter makes X2 tokens (`mintReactorToken({ model })`; `mintX2Token` is the X2 default).

## Call sequence (browser)

1. In parallel: `POST .../support-call/brief` (Gemini, cached per ticket) and
   `GET .../support-call/portrait` (Nano Banana composite, cached per ticket; generation starts
   when the ticket is sent, the call waits at most 25 s for it, and `X-Portrait-Source` says
   `composite` or `base`). Billing runs from session ready, so nothing connects until both are in
   hand.
2. Token, `new ViduS2AvatarModel()`, `connect(jwt)`, `getStatus() === "ready"`, `getState()`.
3. Avatar: `attachAvatar({ avatar_id })` when the ticket has a saved id built from the same
   portrait (the brief's `avatarPortraitSource` equals `X-Portrait-Source`; wait for
   `avatar_ready`, 30 s), else `uploadFile(blob, { name })` then `createAvatar({ image, name })` and
   wait for `avatar_ready`; the new `avatar_id` and its portrait source are saved with
   `PUT .../support-call/avatar`. An avatar built from the base portrait is rebuilt once the
   composite exists.
4. `startCall` with `persona`, `greeting`, `call_mode: "audio"`, `transcripts: true`,
   `vad: { type: "semantic" }` and `llm: { max_tokens: 90, temperature: 0.6 }`, then wait for
   `session_state.phase === "live"`. Optional fields are omitted rather than sent as null.
5. `main_video` and `main_audio` go on one `MediaStream` on one `<video>`. Typed messages use
   `say({ text })`; the mic is published only after the customer turns it on (`publishMic` /
   `unpublishMic`); `interrupt()` is always reachable.
6. End call: the video and listeners are released and `POST .../support-call/transcripts` is sent
   at once; `endCall()` (raced 5 s) and `disconnect()` then run in the background on that call's
   own model, so "Talk to support again" right away starts a clean call. Unmount or `pagehide`
   skip `endCall()` and disconnect at once (the transcript POST uses `keepalive`). The UI caps the
   call at 4 minutes against `call_max_seconds`, and ends it 10 s before the session's
   `max_session_duration_seconds` (counted from connect) when that comes first.

## Measured

| Step                              | First call (new avatar) | Second call (saved avatar)   |
| --------------------------------- | ----------------------- | ---------------------------- |
| Gemini brief (`gemini-3.8-flash`) | 4.8 s                   | 4.0 s (rewritten, see below) |
| Nano Banana composite             | 14.5 s                  | cached                       |
| Token mint                        | 0.3 s                   | not timed                    |
| `create_avatar` to `avatar_ready` | **50.8 s**              | not needed                   |
| `attach_avatar` to `avatar_ready` | not needed              | about 1 s                    |
| Click to Live                     | about 70 s              | about 8 s                    |
| `end_call` reply                  | not timed               | not within 5 s               |
| `disconnect()`                    | not timed (unbounded)   | 2.7 s                        |
| End call to transcript saved      | about 25-30 s           | 6.7 s                        |

So the first call on a ticket is slow because of `create_avatar`; every later call on the same
ticket re-attaches in about a second. `main_video` reported 640x360 at the moment the call went live
and 864x1184 a few seconds later; the UI frames it at 864:1152 with `object-cover`. One console
warning at connect ("unparseable data message: failed to decode Protobuf message") had no visible
effect.

## Background prep (first call, verified live 2026-10-08 ~13:05-13:14 ET)

The first call used to wait out `create_avatar` after the click. Now the same real work runs
earlier and the click only re-attaches:

- Composite: Nano Banana starts when a fixture case is created (or a product photo is confirmed),
  cached by the photo's sha256 plus the product label, so the same photo and label are never
  generated twice. The ticket path joins or reuses that result; the ticket-send warm stays as the
  backup.
- Avatar: once a ticket exists, the Support tab (`useSamPrep`) runs brief, portrait, then a hidden
  Vidu session through the normal token route: connect, `uploadFile`, `createAvatar`,
  `avatar_ready`, `PUT .../support-call/avatar` with the portrait source, disconnect. One prep per
  page (single flight), and clicking Talk stops it (its session disconnects). A base-portrait build
  re-checks the portrait twice (5 s apart) and rebuilds once if the composite lands. The status line
  shows the real step and elapsed time, then "Sam is ready"; a failure says Talk still builds the
  avatar itself.

Three scripted runs on a local stack (API-driven Robot vacuum case and ticket with a synthetic take,
then the real Support tab in headless Chromium):

| Run | Composite                       | Prep `create_avatar` | Ticket to "Sam is ready" | Click to video | Click to Live |
| --- | ------------------------------- | -------------------- | ------------------------ | -------------- | ------------- |
| 1   | at ticket send, 11.4 s          | 55.5 s               | 70.3 s                   | 5.6 s          | not timed     |
| 2   | at case creation, 13.2 s        | 39.5 s               | 65.7 s                   | 3.1 s          | not timed     |
| 3   | reused (same photo + label key) | 1.9 s                | 15.4 s                   | 3.0 s          | 6.2 s         |

Click to video is `videoWidth > 0` on Sam's `<video>`; Live is the call's own phase label. Run 3's
1.9 s `create_avatar` was a real call on identical portrait bytes; whether Reactor reuses an
identical upload is not verified. Token, connect and upload took about 3-18 s of each prep before
`create_avatar` started.

## Behaviour that is not what the d.ts suggests

- **`greeting` is a cue for the character's LLM, not text it speaks verbatim.** With the greeting
  "Hi, I'm Sam, an AI support agent. I watched your clip ... Does it usually happen on carpet or
  hard floors?" the first transcript line was Sam saying "Hi Sam, thanks for checking. It actually
  happens on both carpet and hard floors ..." (answering as the customer). The server now sends
  `Open the call by saying: "<line>"` (the whole cue within 200 characters) and the ground rules
  say Sam is never the customer. Re-run: Sam opened with "Hi, I'm Sam, an AI support agent. I
  watched your clip of the robot vacuum jerking backward. Does it do this on all floor types?" and
  answered "Are you a real person?" with "No, I'm an AI support agent."
- **`disconnect()` waits out SDK reads still in flight**, including an unanswered `end_call`, which
  is why the first End call took about 25 s before the bounded wait. A later browser run measured
  End to "transcript added" at 10.1-10.2 s on 3 of 3 calls (`end_call` never answered within
  5 s). The transcript save no longer waits for either step; that path is not yet re-measured
  live.
- Transcripts: `speaker` was `"character"` for Sam and `"user"` for the customer; only finals are
  stored. A typed `say()` line was never listed twice in either call (whether the model does not
  echo it, or the 15 s echo filter caught it, was not distinguished).

## Portrait (Nano Banana)

- Interactions API: `ai.interactions.create({ model, input: [text, ...images], response_format:
{ type: "image", aspect_ratio: "3:4", image_size: "1K" }, store: false })`; the image comes back
  as base64 on the output. Adapter: `apps/server/src/providers/nano-banana.ts`.
- Model that worked: **`gemini-nano-banana-2.1`** (`GEMINI_IMAGE_MODEL`, first in the chain). The
  chain falls back through `nano-banana-pro-preview`, `gemini-3-pro-image`, `gemini-3.1-flash-image`
  only on unavailable / bad request / empty output / provider error; those fallbacks were not
  exercised.
- Base portrait: `scripts/generate-support-agent.ts` wrote `apps/web/public/assets/support-agent.jpg`
  (860x1152, about 15.5 s). Head to waist rather than head and shoulders, so the per-ticket
  composite has hands to hold the product. Manifest provenance: "AI-generated with Gemini Nano
  Banana; fictional person".
- Per ticket: the base portrait plus the ticket's product reference photo, cached under
  `DATA_DIR/media/support-agents/`. Generation starts when the ticket is sent and has 90 s. A call
  that has waited 25 s gets the base portrait while generation keeps going and caches its result
  for the next call (a browser run saw 25.0 s once, then 12.2 s on retry). A timeout, rate limit
  or provider error is retried later; only no product photo or a safety block writes a marker
  that keeps the base portrait. Served to the owner customer and Demo Support only. The product
  photo is the customer's own upload and is not screened for people.

## Not verified

- The microphone path (`publishMic`, semantic VAD, spoken transcripts): the automation browser had
  no microphone. Typed `say()` was verified.
- `interrupt()` and the 4-minute cap firing on a real call.
- `attach_avatar` on an avatar older than 90 days (`AVATAR_NOT_FOUND`): the controller falls back to
  `create_avatar` after the 30 s wait, untested live.
- The live check used a local ticket from `scripts/smoke-api.ts` (synthetic take upload) with the
  critic model deliberately set to an invalid id so the take could be accepted with a review note;
  the brief, portrait, token and call were all real provider calls.
