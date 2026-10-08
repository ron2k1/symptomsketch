# SymptomSketch design sketch

Problem: Customers cannot describe a product's odd movement over the phone, and support cannot
easily show the correct way to do a step. Text loses timing, direction and repetition.

Users: a customer (robot vacuum "jerks backward once") and a support teammate in a second browser.

Components:

1. Web (Vite/React): cyber landing hero with product rows, case workspace (Issue / Recreate /
   Support), staff inbox.
2. Server (Express): sessions, cases, Gemini planner + visual critic, Reactor token minting,
   ffmpeg export, tickets, SQLite + media under DATA_DIR.
3. Providers: Gemini 3.8 Flash (plan before, critique after) and Reactor X2 (live video from the
   product photo, steered by the compiled prompt).

Data flow: product photo + "what happened" -> Gemini planner returns a structured action plan with
constraints and highlight spans -> server compiles a bounded X2 prompt -> browser streams the photo
as the X2 source track and shows live output -> Record next take arms a canvas recorder before the
prompt is sent -> server trims + converts to H264 MP4 -> Gemini critic checks the MP4 against the
frozen plan -> human accepts the exact bytes -> ticket to Demo Support -> teammate replies with text
or an instructional clip made in the same editor.

Demo cut-line: robot vacuum demo -> plan -> live X2 preview -> one correction -> record -> MP4 ->
critic -> accept -> send to Demo Support -> teammate text reply visible to customer.

NOT building (Quick Demo): source-video input, text-to-product image generation, PDF manuals, voice,
email sending, manufacturer integrations, more validated categories.
