# SymptomSketch design sketch

Problem: Customers cannot describe a product's odd movement over the phone, and support cannot
easily show the correct way to do a step. Text loses timing, direction and repetition.

Users: a customer (robot vacuum "jerks backward once") and a support teammate in a second browser.

Components:

1. Web (Vite/React): mockup-style landing hero with product rows, case workspace (Issue / Recreate /
   Support), staff inbox.
2. Server (Express): sessions, cases, Gemini planner + visual critic, Reactor token minting,
   ffmpeg export, tickets, SQLite + media under DATA_DIR.
3. Providers: Gemini 3.8 Flash (plan before, critique after) and Reactor X2 (live video from the
   product photo, steered by the compiled prompt).

Data flow: product photo + "what happened" -> Gemini planner returns a structured action plan with
constraints and highlight spans -> server compiles a bounded X2 prompt -> browser streams the photo
as the X2 source track and keeps generating until Stop -> Clip last N s stops one of two staggered
canvas recorders, keeping the last 5 to 11 s ending at the click -> server trims + converts to H264
MP4 -> Gemini critic checks the MP4 against the frozen plan -> human accepts the exact bytes ->
ticket to Demo Support -> teammate replies with text or an instructional clip made in the same
editor.

Reactor-first presentation:

- Type: three faces, one job each (tokens in `apps/web/src/index.css`). Inter for UI chrome;
  JetBrains Mono as `font-reactor` for everything that names or shows off Reactor X2 (the
  `ReactorMark` chip, the "Live · Reactor X2" stage badge, live stats); Source Serif 4 as
  `font-voice` for the customer's words (every text box and conversation bubble, on a sand-tinted
  field with a stronger edge and a primary focus ring).
- Theater layout: while an X2 session is active or a take is on stage, Recreate drops to two
  columns (stage | 304px conversation) and the product shelf folds into a chip row above the stage.
- Copy names the engine wherever a judge looks: stage badge, connect/disconnect/error copy, landing
  "Powered by Reactor X2, a real-time world model". The landing itself starts no session.

Demo cut-line: robot vacuum demo -> plan -> live X2 preview -> one correction -> clip -> MP4 ->
critic -> accept -> send to Demo Support -> teammate text reply visible to customer.

NOT building (Quick Demo): source-video input, text-to-product image generation, PDF manuals, voice,
email sending, manufacturer integrations, more validated categories.
