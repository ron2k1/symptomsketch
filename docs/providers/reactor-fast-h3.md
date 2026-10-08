# MiniMax FastH3 on Reactor (Story mode), verified live 2026-10-08

Story mode (Interactive Narrative) uses MiniMax FastH3 through Reactor: text or a starting image
in, a short video clip WITH synchronized generated sound out, played from a server-side queue.
Everything below was checked with real sessions on this project's key from this branch
(`feat/incident-story`) through the installed `@reactor-team/js-sdk@3.1.0`. Anything not observed
live says so.

Code: token `apps/server/src/providers/reactor-token.ts` (`FAST_H3_MODEL_RESOURCE`), routes
`apps/server/src/story/routes.ts`, browser wrapper `apps/web/src/features/story/fast-h3.ts`.

## Token and model name

- Mint with the same `POST https://api.reactor.inc/tokens` exchange as X2
  (`docs/providers/reactor-x2.md`), model resource **`reactor/fast-h3`**, `max_sessions: 1`,
  `expires_after` 900 s, `max_session_duration_seconds` 540 (`STORY_LIMITS.tokenSessionMaxSeconds`,
  a little above the 480 s client cap).
- The browser SDK's `modelName` must be the same string, `reactor/fast-h3`
  (`FAST_H3_MODEL_NAME` in contracts). The JWT is the only thing the browser gets; it is never logged.
- Customer story: `POST /api/cases/:caseId/story/token` (case owner). Support's ending:
  `POST /api/tickets/:ticketId/story/ending/token` (support only). Both answer `Cache-Control: no-store`.

## SDK usage (3.1.0)

```ts
const reactor = new Reactor({
  modelName: "reactor/fast-h3",
  modelTracks: [
    { name: "main_video", kind: "video", direction: "recvonly" },
    { name: "main_audio", kind: "audio", direction: "recvonly" },
  ],
});
reactor.on("statusChanged" | "message" | "error" | "trackReceived", ...);
await reactor.connect(jwt);
const reply = await reactor.sendCommand(name, data); // 3.x: resolves the correlated reply
const ref = await reactor.uploadFile(blob); // FileRef for starting_frame
await reactor.disconnect();
```

- Two receive tracks arrive through `trackReceived`: `main_video` and `main_audio`. Put both in ONE
  `MediaStream` on one `<video>`: picture and sound stay in sync and `MediaRecorder` records both.
- `unwrap()` in `fast-h3.ts` accepts a message either flat or as a `{type, data}` envelope, so the
  rest of the app reads one shape.
- SDK status values: `disconnected`, `connecting`, `waiting`, `ready`. The app treats an unexpected
  `disconnected` mid-story as "the Reactor session ended" (error with Retry, no reconnect loop).

## Commands used (all observed working)

| Command                 | Data                                                                                       | Reply                  |
| ----------------------- | ------------------------------------------------------------------------------------------ | ---------------------- |
| `set_canvas`            | `{aspect: "16:9"}`                                                                         | `canvas_accepted`      |
| `set_flush_on_clip_end` | `{enabled: false}` (hold the last frame between clips)                                     | `flush_accepted`       |
| `set_autoplay`          | `{enabled: false}` (the app sends `play` itself)                                           | `autoplay_accepted`    |
| `set_clip_seconds`      | `{seconds: 5.875}`                                                                         | `clip_length_accepted` |
| `get_state`             | `{}`                                                                                       | `state_update`         |
| `enqueue`               | `{prompt, seconds, metadata, position?, starting_frame?: FileRef, continue_from_clip_id?}` | `clip_queued`          |
| `play`                  | `{clip_id}`                                                                                | (clip_started follows) |
| `move`                  | `{clip_id, position}` (`0` = build next, used to jump a picked or typed scene ahead)       | `clip_moved`           |
| `pop`                   | `{clip_id}` (drop branches the customer did not pick)                                      | `clip_popped`          |

- `starting_frame` opens a clip from an uploaded image: the customer's product photo for the story's
  opening, and the story's last frame (PNG) for support's ending.
- `continue_from_clip_id` continues from another clip's end. The story builds every offered choice
  ahead as its own branch clip continuing from the scene on stage; the ending's scene 2 continues
  from its scene 1.

## Message keys (top-level keys only, logged once per type in the browser console)

| Type                   | Keys                                                                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state_update`         | aspect, autoplay, clip_seconds, clip_seconds_max, clip_seconds_min, clips_played, flush_on_clip_end, generation_capacity, generation_queued, height, playing, playing_clip_id, playout_capacity, playout_queued, seconds_sent, seed, valid_commands, width |
| `canvas_accepted`      | aspect, height, width                                                                                                                                                                                                                                      |
| `flush_accepted`       | enabled                                                                                                                                                                                                                                                    |
| `autoplay_accepted`    | enabled                                                                                                                                                                                                                                                    |
| `clip_length_accepted` | clip_seconds, frames                                                                                                                                                                                                                                       |
| `queue_update`         | generation, history, playout                                                                                                                                                                                                                               |
| `clip_queued`          | clip                                                                                                                                                                                                                                                       |
| `clip_generated`       | clip                                                                                                                                                                                                                                                       |
| `clip_started`         | clip                                                                                                                                                                                                                                                       |
| `clip_popped`          | clip                                                                                                                                                                                                                                                       |
| `clip_moved`           | clip, position, queue                                                                                                                                                                                                                                      |
| `clip_finished`        | clip, seconds_sent                                                                                                                                                                                                                                         |

- A clip's id is `clip.clip_id` (the wrapper also accepts `id`).
- A clip is "built" when `clip_generated` names it or it sits in `queue_update.playout`. The UI
  shows queued / building / ready / playing / played / popped only from these messages.
- `clip_failed`, `clip_stopped` and `command_error` are handled but were NOT observed live.

## Clip length

- `set_clip_seconds 5.875` is accepted as **141 frames at 24 fps**: FastH3 snaps to a 17n+5 frame
  grid, so 5.875 s is exact and the whole session uses one clip length.
- Canvas 16:9 rendered at **1344x768** (P0 recording).

## Timings measured live (Playwright, real Gemini + FastH3)

| Step                                                       | Measured                           |
| ---------------------------------------------------------- | ---------------------------------- |
| Start click to the opening scene playing                   | 20-23 s (21.7 s in the P1 run)     |
| Branch clip queued to built                                | median 5.4 s (5.9 s last)          |
| Typed scene moved to the front, to built                   | 5.0 s                              |
| Pick to play, branch already built                         | 0.1-0.4 s                          |
| Pick to play, branch still building                        | 4.4-5.5 s                          |
| Story director (Gemini, one call per beat)                 | median 5.1-6.2 s (3.3-7.2 s range) |
| Send to support (7,326,698-byte webm + 1,579,831-byte PNG) | 201 in 0.2 s on localhost          |
| Ending director (Gemini, support's fix to 2 scenes)        | 4.0-5.2 s (5 runs)                 |
| Write the ending click to ending scene 1 on stage          | 10.0-12.4 s (4 runs)               |
| Ending scene 1 start to scene 2 start                      | about 6 s (scene 2 built in time)  |
| Write the ending click to "The ending played"              | 22-25 s                            |

## How the app stores a story (P1)

- The customer's browser records the one FastH3 `MediaStream` with `MediaRecorder` (webm vp9/vp8 +
  opus), only while a scene plays, and keeps the last frame as a PNG from the `<video>`.
- `POST /api/cases/:caseId/story/submit` (owner only, multipart: `reel`, `frame`, `beats`) checks
  size caps (413), container bytes (webm/mp4, 422), PNG magic (400) and a per-case cap (429).
- Table `case_stories` (created with `CREATE TABLE IF NOT EXISTS` at registration, so it does not
  take a migration number from a parallel branch): case, owner session, ticket (nullable; a story
  sent before any ticket shows on the ticket sent later), reel and frame asset ids, beats JSON.
- Support reads it on the ticket: `GET /api/tickets/:ticketId/story`, `/story/reel?story=`,
  `/story/frame?story=` (ticket membership: owner or support; others 404; Range supported).
- `MediaRecorder` webm has no duration in its header, so a player shows the duration only after
  it has read the file; seeking before that is limited.

## Support's ending (P2)

- `POST /api/tickets/:ticketId/story/ending/director` `{text}` (support only; at most 400 chars)
  returns 1-2 scenes from Gemini; the story and support's text are fenced data.
- The browser opens a NEW FastH3 session with an ending token, uploads the story's last frame,
  enqueues scene 1 with that `starting_frame` and scene 2 with `continue_from_clip_id`, and plays
  them in order on `clip_generated`. The ending is recorded in the staff browser for a replay and
  is not stored on the server.
- Verified live: both ending scenes open from the uploaded PNG at 1344x768 with sound, scene 2
  continues from scene 1, the session closes after the last `clip_finished`, and the replay webm
  (about 3 MB for two scenes) plays at 1344x768.
- The director call and the session setup (token, last-frame download, connect, configure, upload)
  run in parallel, which is why the first ending scene lands faster than the story's opening.
- Keep the replay `<video>` a different element from the live one: an element that still has
  `srcObject` set ignores `src`, so a reused element shows the closed stream (seen live as 2x2).
- One attempt failed about a second after the click with an SDK error while the server had issued
  the token. It did not repeat in the next four runs; the app now shows the SDK error by code and
  operation (`reactorFailure` in `fast-h3.ts`) with Retry.
