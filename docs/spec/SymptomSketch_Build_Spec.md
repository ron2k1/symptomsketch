# SymptomSketch Product and Build Specification

## Visual context for product support

Prepared for Ronil Basu. Version 1.1. October 8 2026. Selected release: the Quick Demo profile with a four-hour feature target and one to two hours of deployed verification, conditional on the first provider test.

SymptomSketch helps customers show what a product did and helps support agents demonstrate an approved use step. The user enters through a scrolling product page, opens a persistent case, refines a visual illustration, and reviews a downloadable MP4. A real teammate can receive the submitted case and reply through the application's Demo Support inbox.

The supplied SmoothScrollHero component provides the opening page's expanding image and parallax structure. The attached cream, sand, and forest-green workspace provides the visual theme. Product selection is the primary entry. The working case has Issue, Recreate, and Support tabs with restrained highlights on the words that define the action.

Gemini is the reasoning layer before generation and the visual checking layer after it. Reactor creates the moving visual. The application retains the source, explicit constraints, revisions, uncertainty, and human review. Correct behavior must be demonstrated with actual model calls and the final exported files.

This revision supersedes the earlier broad P0 scope. Photo input, one demo product, both communication directions, a visual check, MP4 export, and an internal support handoff are required. Source-video input, text-generated product references, and company integrations belong to the Next profile. The full future contracts remain documented. The supplied source component is preserved verbatim in the handoff and the self-contained CLI prompt. UI images are design concepts. This document does not claim that the application is already implemented or that the supplied API keys have been tested.

## 1 Product decisions

### Core promise

Choose the demo product or upload a product photograph. Explain what happened or what you tried. Refine a visual reconstruction. Capture and review the result. Download a short clip that gives the other person more context. Creating a product reference from text is specified for the Next profile.

For the reverse direction, provide the product model and an approved procedure. Create a visual explanation of a bounded setup or use step. Review the saved result against its source and download it for the customer.

The product supports communication of observable actions. A generated clip does not establish the cause of a fault, prove that an event occurred, or establish the mechanics of a product. The user's phrase "exactly how I did it" is implemented as explicit action details plus iterative human review. Visual fidelity is a measured product constraint, not a guarantee from the generation API.

### Two operating modes

| Mode              | Initial input                                            | Final review meaning                                                    | Output label                            |
| ----------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------- |
| Show the problem  | Original account, product reference, what the user tried | The saved clip matches the customer's description                       | AI-generated reenactment                |
| Show the solution | Product identity, approved procedure, source reference   | The agent checked the saved illustration against the supplied procedure | AI-generated instructional illustration |

Keep the customer action labeled "Matches my description". In solution mode use "I checked this against the supplied instructions". Neither action produces a generic verified badge.

### Creating a product from scratch in the Next profile

When the Next profile is implemented, the user can type a description such as "a small round white robot vacuum with a dark circular top and a front bumper". A Gemini image model creates a candidate reference. The user reviews its visible features and chooses Use this product. Persist those exact image bytes and the confirmed feature description. All later attempts reuse that reference revision.

Label this source Generated product concept. It does not imply a real manufacturer model, a functional CAD assembly, dimensions, or an available manual. The user can describe how they assembled or used an actual object in the action fields. The first release visualizes one selected action per downloadable clip; complete multi-step assembly movies are a later extension.

### Product selection before company selection

Use two working entry rows: Robot vacuum with Start demo, and Your own product with Upload product. A concrete product makes the action visible immediately and lets one representative movement be tested. Company or model is optional secondary metadata. The demo product routes to SymptomSketch Demo Support, an internal queue operated by a teammate. A company name typed by a user does not establish a support integration or a manufacturer relationship.

### Initial customer and commercial hypothesis

Start with consumer-product support teams whose cases involve visible movement or an action that is difficult to explain. The customer-facing tool can work before the support company adopts it because its output is an ordinary attachment. Repeated agent use is the initial subscription hypothesis. Validate comprehension and clarification effort before claiming fewer returns or lower support costs.

## 2 Release scope

P0 is the selected Quick Demo profile. It is the completion contract for the CLI. Next capabilities must remain hidden until they are actually implemented. The earlier release's P0 labels are superseded by this table.

| Capability                                       | Priority | Release boundary                                                                                  |
| ------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------- |
| Scrolling opening page                           | P0       | Adapt supplied expanding-image hero, parallax, navigation, and product rows to the approved theme |
| Product selection                                | P0       | One tested robot-vacuum fixture plus a working photo-upload path                                  |
| Issue Recreate Support tabs                      | P0       | Persistent case state, meaningful routes, keyboard navigation                                     |
| Upload a product photo                           | P0       | JPEG PNG or WebP; preserved original and validated working reference                              |
| Preserve the original account                    | P0       | What happened and What I tried remain distinct                                                    |
| Gemini reasoning and clarification               | P0       | Structured action plan, explicit constraints, source grounding, uncertainty                       |
| Keyword highlights                               | P0       | Exact phrases and structured details; no inferred diagnosis                                       |
| Real Reactor X2 output                           | P0       | Actual returned frames, prompt revisions, honest status                                           |
| Record the next attempt                          | P0       | Arm before requesting the action; default eight seconds of output                                 |
| MP4 conversion                                   | P0       | Real H264 MP4 with permanent labels and a usable attachment size                                  |
| Gemini visual check                              | P0       | Compare the finalized clip with the frozen plan and source; report discrepancy or uncertainty     |
| Human final-file review                          | P0       | Purpose-specific decision tied to exact MP4 bytes                                                 |
| Download and copy explanation                    | P0       | Manual email attachment remains available                                                         |
| Internal support submission                      | P0       | One immutable submitted ticket snapshot in Demo Support                                           |
| Actual teammate reply                            | P0       | Separate support session, persisted text reply, customer playback and refresh                     |
| Source-based instructional reply                 | P0       | Reuse the same editor in an agent-owned case and attach one reviewed response clip                |
| Persistence and deployment                       | P0       | Restore case, ticket, replies, and completed media after refresh and service restart              |
| Source-video input                               | Next     | MP4 or WebM input and normalization; hidden in Quick Demo                                         |
| Product reference from text                      | Next     | Actual Gemini image call and explicit reference selection; hidden in Quick Demo                   |
| PDF manuals and stitched steps                   | Next     | Pasted approved text covers Quick Demo                                                            |
| Other categories and direct company integrations | Later    | Validate categories and onboard real teams individually                                           |
| Voice narration public links CRM plugins         | Later    | Separate capabilities with their own requirements                                                 |

The live acceptance set is one demo reference, one uploaded photo, one corrected customer movement, one teammate text response, and one source-based instructional response. The upload path accepts a product photo without claiming all categories have validated generation fidelity. Show only working choices in the selector.

The user has Reactor and Gemini API keys. The CLI must load them from the local server environment and verify their actual access. It must also have a writable persistent host and authorized deployment access to finish the deployment. A key's presence is not evidence that a model call succeeded.

## 3 Product references and input rules

### Real product input and demo reference

Quick Demo accepts photo drag and drop or the file picker. Demo selection copies an allowlisted sample photo into a case-owned product revision and labels it Demo reference. Show the untouched source thumbnail, filename, type, and the model entered by the user. Do not infer a specific manufacturer model from appearance and silently treat it as confirmed.

Store the original upload separately from a normalized reference. The source-clip limits below apply only to the Next profile. Limit still uploads to 10 MiB and source clips to 20 MiB and 15 seconds. Validate file signatures and decoded media, not only extensions. Normalize a working copy to a maximum 1280-pixel long edge. Fix rotation and strip location metadata from the working copy. Keep the original private and available to its owner until the case expires or is deleted.

Use a stable 16 by 9 source canvas for X2. Contain the media without stretching or cutting off the product. Letterboxing is allowed. In the Next profile, a source video is decoded in the browser and drawn into this canvas; a still is repeatedly drawn. Looping a source clip is explicit in the UI. Preserve the frame dimensions throughout a generation session.

### Text-generated product input in the Next profile

When extended inputs are enabled, require a product description and an optional list of visible features. Call the configured Gemini image model on the server. An empty, blocked, or malformed image response is a failure with a retry action. A bundled stock image cannot stand in for a successful generation.

After generation, show the candidate with Use this product and Refine product. The user can edit the concept before selecting it. Each selected reference creates an immutable product revision with an image hash. Replacing the reference later creates a new revision and resets the active Reactor scene. Existing captured takes retain their old reference.

The source type remains visible in the interface and the export message. A clip using a generated reference also carries a permanent Generated product concept label in its video pixels. A generated product concept may be used for an illustrative procedure authored by its creator, but it must not be presented as instructions for a verified commercial model.

### Initial context fields

Customer mode collects What happened and What I tried as separate text fields. Keep the original wording. Timing, repetition, trigger, starting condition, and uncertainty can be clarified through the conversation. Product model is optional here but recommended.

Solution mode requires a product/model label, a named procedure, approved instruction text, and a source description. Quick Demo uses pasted approved text with a company procedure identifier, manual title with page/step, or explicitly authored demo procedure. Source-video demonstrations are a Next input. A real-model procedure requires the agent to confirm that the source applies to that model. For generated concepts use an explicit authored demonstration source and retain the concept label.

## 4 Customer workflow

1. Open the landing page. The hero shows an Example workspace and a visible Choose your product action. No paid model call occurs here.
2. Scroll or use the navigation action to reach What do you need help with. Select Start demo or Upload product.
3. If there is no customer session, show the short demo-access-code sheet while retaining the product choice; POST /api/session establishes the cookie. Then create the owned case, validate/select its photo, and open Issue with the reference and optional product/model field. Cancelled photo selection preserves the draft and offers a retry.
4. Enter What happened and What I tried. Preserve the original wording before generating interpretations.
5. Continue to Recreate. Gemini returns a structured action plan, a short understanding summary, and at most one focused clarification question. Resolve blocking ambiguity and confirm the selected action.
6. Create the Reactor preview. Make corrections in ordinary language or select a highlighted detail to edit it. Preserve constraints that the user did not change.
7. Select Record next take. Arm capture before dispatching a fresh action request so a brief movement can be captured from its beginning.
8. Convert the take to MP4 and run Gemini's separate visual check on that final file. Display the result and the evidence it could or could not observe.
9. Review the exact MP4. Choose Matches my description, Keep refining, or I'm not sure. A favorable AI check never clicks this decision for the user.
10. Open Support. Review the explanation and selected attachments. Send to Demo Support creates an immutable ticket snapshot. Download MP4 and Copy email explanation remain available for an external support email.
11. A real teammate's reply appears in the ticket thread after polling or refresh. The customer can play and download an attached instructional reply clip.

### Example demonstration

Original account: "The vacuum stops and then jerks backward once. It only happens sometimes."

Correction: "The backward movement is smaller and happens immediately."

The plan preserves one repetition and intermittent frequency. It must not add an error code, a damaged part, a cause, or repeated rocking. Highlight backward, once, and immediately only where they are supported by the displayed account or current plan.

An uncertain take remains editable and saved. Do not force a positive answer to continue. A mismatched or incomplete take cannot be silently included in the normal support handoff. Any explicit manual acceptance of an uncertain customer reenactment retains the uncertainty and its review note in the ticket and copied explanation.

## 5 Support workflow and internal inbox

### Actual support connection for the demo

All demo submissions go to one internal queue named SymptomSketch Demo Support. A teammate opens /support in a separate browser profile and authenticates with DEMO_SUPPORT_CODE. The server assigns the support role after checking that code. A query string, localStorage value, or client-supplied role cannot grant support access.

The customer-facing Support tab is the customer's own case thread. It is not the staff login. Product selection alone does not send a message or claim an agent is present. Use Received by Demo Support only after the server stores the submitted ticket. Never show a fabricated online agent, typing indicator, wait time, manufacturer partnership, or automatic human reply.

The ticket freezes the selected take and MP4 hash, product/reference, original account, actions tried, unresolved details, visual-check status, and edited message. Quick Demo submission visibly includes the canonical normalized reference and accepted clip; the confirmation panel names both attachments before Send. The untouched original is an optional extra attachment. A user who does not want to share the reference can keep working or use the manual download/email path. Support receives only these explicitly submitted assets. A repeated submission with the same idempotency key returns the same ticket.

Support can read submitted ticket snapshots and their attachments. It cannot browse unsubmitted cases, alternate takes, private chat history, or unrelated files. Customers can read only their own tickets. Submission does not transfer case ownership or permit support to rewrite the customer's original account.

### Text and instructional replies

1. A teammate opens a submitted ticket and views the customer's account, submitted reference, and reviewed MP4. The untouched original is available only if the customer included it.
2. The teammate enters a real text reply. Persist it with a support author and timestamp. Refresh or modest polling shows the same reply to the customer.
3. To illustrate a step, select Reply with a demonstration. The server creates an agent-owned work case from the submitted reference with lineage back to the ticket.
4. Supply the applicable product/model, procedure title, approved step text, and source. The demo may use an explicitly authored normal-use positioning procedure. Do not describe an authored demo as a manufacturer's manual.
5. Gemini reasons over the provided instructions and returns one bounded action, prerequisites, source links, and uncertainties. The agent checks this text before generation.
6. Create and refine Reactor output in the same Recreate workspace. Changes to presentation must preserve the source-supported direction, order, and prerequisites.
7. Record, convert, run the visual check, and review the exact final MP4 against the procedure. A material source contradiction must be corrected before it is sent as an instruction.
8. Attach the accepted reply take to the ticket. Grant the customer access to that exact reply asset through the ticket. The customer can play and download the same reviewed bytes.

Use a three-second polling interval while the thread or inbox is visible, with backoff after failures. Pause polling for hidden tabs. WebSockets and live chat presence are unnecessary for this demo. The Send and Reply actions require explicit clicks; typing a draft does not transmit it.

A manual establishes the stated steps without establishing generated geometry. When a connector, latch, or hand placement matters, an actual demonstration or sufficiently detailed product-specific source is required. If the source or output cannot support that detail, return Unable to verify and select a simpler supported step. The P0 instruction should be a broad action whose visible outcome can be checked.

### Thread attachment permissions

Use a ticket attachment record to identify the exact allowed media and hash. Playback and download controllers check both ticket membership and attachment membership. Do not give support general access to owner-only asset routes. To reuse a submitted source for an agent work case, make an authorized case-owned copy with immutable source lineage. Do not accept arbitrary foreign asset IDs from the browser. A reply take must belong to the authenticated support session's work case, have purpose solution, carry current accepted review/hash bindings, and have immutable lineage to this exact ticket. An accepted take from another ticket is not attachable.

Case deletion or expiry revokes ticket attachments and removes derived private copies associated with that ticket. A delayed reply or visual-check job must recheck the case/ticket lifecycle before publishing output.

## 6 Sandbox interface

### Landing page using the supplied hero

Keep the expanding image, sticky stage, restrained parallax cards, and reveal-on-scroll product rows from the supplied SmoothScrollHero. Replace the SpaceX identity, rocket imagery, launch schedule, dates, and locations with SymptomSketch content. Preserve the attached workspace's warm palette across the landing page and application.

Opening headline: Show what happened. Highlight happened with a sand-colored underline. Supporting copy: Give support the context a phone call cannot. Primary action: Choose your product. The header repeats that action and includes Support workspace for the staff entry.

The hero contains a large photographic product scene in a sand-colored tray, labeled Example workspace. Decorative cards introduce Your product, What happened, and A clip you can share. These are illustrative landing content and do not claim that generation is currently running. Do not begin provider sessions on page load, scroll, hover, or prefetch.

Scrolling reveals What do you need help with. Replace schedule items with two functional product rows. Robot vacuum shows Demo product and SymptomSketch Demo Support, with Start demo. Your own product shows Upload a photo, with Upload product. Company/model is optional secondary metadata inside intake. Future text-created references are hidden until their feature is implemented.

Make product selection reachable immediately through an anchor or button. Do not require the visitor to complete a long animation. Use a bounded desktop scroll section based on the hero's own progress. Mobile and reduced-motion layouts use an ordinary static composition with no tall empty animation spacer. Native scroll and all actions must remain usable if smoothing is unavailable.

### Persistent case tabs

Use Issue, Recreate, and Support as the primary case tabs. Route them as /cases/:caseId/issue, /cases/:caseId/recreate, and /cases/:caseId/support, or equivalent persisted router state with working deep links. Refresh restores the selected tab and case. Browser Back returns predictably. Keep drafts and selected take state above tab panels so a tab unmount cannot discard input.

Issue contains the reference and original account. Recreate uses the attached sandbox layout. Support contains the customer ticket, explanation, selected attachment, and actual replies. Show the problem and Show the solution remain secondary purpose controls inside Recreate. They are distinct from navigation tabs and preserve their separate plan state.

Stop live Reactor playback when leaving Recreate. Disable tab changes during recording or offer an explicit cancel action. A route change never silently creates a new take or switches the purpose of saved work.

### Highlighted words and visible reasoning

Highlight up to three action-defining phrases in a message or summary. Examples are backward, once, and immediately after stopping. Use a pale green background for established details and pale terracotta for the newest correction. Pair the tint with field labels such as Movement, Count, and Timing. Do not highlight entire paragraphs or animate the text continuously.

Gemini returns candidate source spans and field associations. The server validates half-open UTF-16 offsets against the exact stored message and confirms that the substring matches. Reject invalid, overlapping, or stale spans. Render escaped text fragments with semantic mark elements; never inject model-supplied HTML. A span based on a paraphrase belongs in Current description rather than pretending it appeared in the original account.

Selecting a highlight focuses the corresponding editable field or composer. Updating it creates a plan revision through the same planner path and preserves untouched constraints. It never rewrites the immutable original account. Keyboard users can reach the equivalent detail controls without interacting with inline text. Announce a changed description once through the accessible live region.

Display Gemini's result as three compact items: What I understood, What will stay the same, and What is still unclear. These are concise final explanations from structured output. Do not show raw chain-of-thought, speculative diagnostic reasoning, or provider debug traces.

### Visual direction

The main workspace feels like a shallow physical sandbox or model-making tray. Use warm ivory around a sand-colored stage, a softly raised rim, restrained shadows, and a fine decorative grain. Place product references on a left shelf and the conversation on a right card. A horizontal shelf beneath the stage holds saved takes.

The video itself remains an ordinary undistorted rectangle. Do not apply an isometric transform to its pixels. Sandbox depth is a CSS treatment around the stage. The P0 design does not require a 3D engine, simulated sand, sprites, or movable physical objects.

### Design tokens

| Token          | Value                              | Use                                        |
| -------------- | ---------------------------------- | ------------------------------------------ |
| Page           | #F6F3EC                            | Warm ivory background                      |
| Tray           | #E7D9BE                            | Sand workbench                             |
| Surface        | #FFFDFA                            | Reference and conversation cards           |
| Ink            | #292824                            | Primary text                               |
| Muted ink      | #6C6258                            | Secondary text                             |
| Primary action | #315D4F                            | Deep green with white text                 |
| Accent         | #AD5337                            | Terracotta capture accent                  |
| Border         | #D9D1C5                            | One-pixel structure                        |
| Type           | Inter with system sans fallback    | Locally bundled licensed font if available |
| Radius         | 12px controls 18px cards 24px tray | Consistent corners                         |
| Touch target   | At least 44 by 44px                | All primary interactions                   |

Use 15 to 16px body text, 20 to 24px workspace headings, and 12 to 13px secondary metadata. Color alone must not communicate status. Validate contrast in the implemented styles. Use ordinary focus outlines and respect reduced-motion preferences.

### Desktop composition

At 1180px and wider, use a 64px header, a maximum 1600px content width, 20px gaps, a 232px reference panel, a flexible center, and a 336px conversation panel. Keep the mode selector above the stage. On a 1440px viewport the center must retain a readable video and usable controls.

Header: SymptomSketch, the selected product, Back to products, and the Issue Recreate Support tabs. Secondary mode selector: Show the problem and Show the solution. Mode changes use separate purpose-specific plan pointers and conversation context within the case. Initialize a new plan on the first switch, reuse the selected product reference, and retain the applicable procedure on the solution branch. Switching back restores that mode's plan; it never relabels the other mode's work. Existing takes retain their purpose.

Reference panel: original media, source label, product/model, Change reference, and source instructions in solution mode. Quick Demo shows Change photo. Create a product appears only when the Next-profile image-generation path is implemented and enabled.

Stage: a live or saved-video badge, a 16 by 9 player, Compare original, Record next take, and Stop preview. Compare original temporarily shows the real source without modifying the generated take. Record next take prepares a fresh attempt and captures a default eight seconds of generated output, with an optional early stop after four seconds. A secondary Capture current preview control may save future frames from an ongoing movement, but it must not imply retrospective capture. No camera-angle, physics, or object-position control appears unless it is implemented.

Conversation: Describe and refine heading, chronological messages, Current description, a multiline composer, and Update preview. The Current description is a compact view of the stored action plan. Clicking a detail lets the user correct it through the same plan workflow.

Take shelf: thumbnail, take number, short caption, and one honest state such as Processing, Review, Matched, or Rejected. Selecting a take loads its own MP4 and plan. The latest live scene is not a saved take.

### Review and export state

Replace the live player with the finalized MP4 and show the take number. For a customer, show Matches my description, Keep refining, and I'm not sure. For support, show the source and the review statement. The export panel contains Download MP4, Copy email explanation, and Download original. Continue to Support opens the ticket preparation panel without sending anything. The file size and duration come from the finalized media metadata.

A successful clipboard write shows Message copied. If clipboard access fails, show a selectable text area with manual-copy instructions. Do not display Email sent or imply that a file has been attached automatically.

### Tablet and mobile

From 768 to 1179px, collapse the product shelf into an expandable section and place the conversation below the stage. Below 768px, use one column with the source summary, player, current action, conversation, and take shelf. A sticky composer must not cover playback or export controls. Use inline playback and a user gesture to begin preview or playback where the browser requires it.

The primary tested creation browser is current desktop Chrome. Verify the specified mobile layout and playback separately. A recording capability check must explain unsupported creation features before a user spends time or generation credits. Responsive appearance alone is not a claim of cross-browser recording support.

### Copy and interaction states

| State                              | User-facing copy                           | Enabled action                                           |
| ---------------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| Empty                              | Make the movement easier to explain        | Start demo or upload a photo                             |
| Product generation in Next profile | Creating your product reference            | Cancel                                                   |
| Planning                           | Understanding the action                   | Preserve editable input                                  |
| Connecting                         | Connecting to the visual workspace         | Cancel                                                   |
| Waiting for frames                 | Preparing your preview                     | Stop preview                                             |
| Live                               | Live preview                               | Refine Record next take Stop                             |
| Correction submitted               | Updating the movement                      | Stop; recording disabled until the current plan is ready |
| Record armed                       | Preparing the next take                    | Cancel; recording begins before the action request       |
| Capture                            | Recording with elapsed time                | Stop and review                                          |
| Upload or conversion               | Preparing your MP4                         | Keep the case available                                  |
| Visual check                       | Checking the clip against your description | View saved clip; keep work preserved                     |
| Review                             | Review this saved clip                     | Confirm Refine Unsure                                    |
| Accepted                           | Ready to attach to your message            | Download Copy explanation                                |
| Provider failure                   | The preview could not be created           | Retry with the existing work preserved                   |

Announce meaningful status changes through an accessible live region. Do not announce every frame. Ctrl or Cmd plus Enter submits a correction; Enter inserts a new line. The source, video controls, take selector, and review actions must be keyboard reachable.

## 7 Application architecture

Use React and strict TypeScript with Vite, shadcn/ui, and Tailwind CSS for the frontend. Use an Express TypeScript server for same-origin API routes and static delivery of the frontend build. Put both in one Docker web service with system FFmpeg and FFprobe. Store SQLite and media under a persistent DATA_DIR, defaulting to /data in the deployed container.

Reactor media travels directly between the browser and Reactor. The application server issues scoped tokens, calls Gemini, validates requests, stores records, processes exports, and serves authorized media. This avoids proxying the live video through the application server.

| Component            | Responsibility                                                                    |
| -------------------- | --------------------------------------------------------------------------------- |
| Product intake       | Upload validation and selection of a canonical reference                          |
| Gemini adapter       | Reasoning planner and separate visual critic; image creation in the Next profile  |
| Reactor adapter      | Source track, session lifecycle, prompts, output track, cleanup                   |
| Capture compositor   | Draw output and permanent captions into recorded pixels                           |
| Export worker        | Validate recording and create the final MP4                                       |
| Case repository      | Persist references, revisions, takes, assessments, reviews, and messages          |
| Demo support service | Immutable submissions, scoped attachments, staff sessions, text and video replies |
| Media controller     | Authorized byte-range playback and attachment download                            |
| Sandbox UI           | Present actual operation state and direct user actions                            |

Keep these responsibilities in separate modules with shared request schemas. Prefer a reducer for transient UI state and a small repository layer for SQLite. Avoid adding a second database, a separate queue service, or an authentication provider for the first demonstration. Use the same SQLite job mechanism for bounded export and visual-check jobs. The landing component only receives catalog props and callbacks; it owns no provider credentials or case database state.

## 8 Reactor integration contract

Use the official X2 SDK and reference frontend as implementation references. The documented package is @reactor-models/x2. Token authorization uses model resource xmax/x2. The server exchanges REACTOR_API_KEY for a short-lived scoped token through the documented token API. Use max_sessions of one per issued token. [1]

Publish the stable source canvas, apply the selected reference as appropriate, then set the action prompt. X2 returns its main_video track. Handle state_update, prompt acknowledgments, command errors, and disconnections. A prompt acknowledgment proves receipt, not visual correctness. Wait for new decoded output before reporting the corrected preview as available. Record next take uses the separate armed-recording sequence below and does not depend on reacting after the action is visible.

Prompt changes must be serialized. Include a plan revision ID in application state and discard stale planning responses. The application must not change the active source while recording. Replacing the reference follows the documented reset, reference reapplication, and prompt sequence. Reset is distinct from closing and releasing the connection. [1]

Stop the preview after capture, on explicit Stop preview, after an application idle timer, and on case disposal. Release browser tracks and adapter resources using the pinned SDK's documented cleanup method. No deterministic regeneration or permanent provider-side scene memory is assumed.

### Connection and cost controls

The token route requires an app session and a valid demo access gate. A customer passes DEMO_ACCESS_CODE; an authenticated staff session established by DEMO_SUPPORT_CODE is also eligible for its own authorized work cases and does not require a second customer login. Apply this role-aware eligibility to paid planner and critic routes as well. Both roles share rate, concurrency, and cost limits. Limit issuance per session and globally. Default to one live scene per app session and two live scenes across the small demo service. Browser heartbeats update a server-side lease; expired leases release application capacity.

Use a 90-second preview-idle timer with visible Continue preview and a five-minute maximum session target. These application controls reduce ordinary usage but are not a hard provider billing ceiling if a browser-held token remains valid. Configure provider-side limits where supported and verify billing behavior during the spike. Never expose the long-lived API key to the browser or log issued tokens.

## 9 Gemini reasoning and visual checking

### Model roles and configuration

Use two separate Gemini calls around Reactor: a reasoning planner before generation and a visual critic after MP4 conversion. They may use the same configured Gemini model, but they have separate prompts, schemas, jobs, and outputs. No third AI provider or additional AI key is required.

Use the current Interactions API consistently with the tested @google/genai version. Start with gemini-3.8-flash for GEMINI_TEXT_MODEL and GEMINI_CRITIC_MODEL, subject to actual account access. The current thinking guide documents generation_config.thinking_level; medium is the starting application setting. Model IDs, supported levels, and quotas must be checked during the first live test. The Next-profile image model is configured independently. [2] [3] [4] [18]

Build each planner request as a fresh interaction from the canonical app state. Include the original account, source reference, previous validated plan, new correction, purpose, and applicable approved procedure as task data. Do not attempt to reconstruct the provider's internal thought history or rely on provider-side memory. Request the final structured result through response_format and validate it with Zod. Persist the user-facing result and application revisions.

### Reasoning planner contract

The planner produces an action plan, a concise understanding summary, a list of preserved constraints, unresolved details, source associations, candidate keyword spans, and at most one clarification question. Every required visible constraint has a stable ID, an expected value, a source pointer, and a critical flag. Example constraints include direction=backward, repetition=one, timing=after stopping, and same visible product features.

In customer mode, the report is the source of the intended reenactment. Distinguish observed behavior, actions the customer tried, and unknown causes. Do not change the user's report to make the generated output easier to accept.

In support mode, the approved procedure is the source of required actions and prerequisites. Each required instruction points to a supplied step or source passage. If the product model is unconfirmed, a prerequisite is missing, or a mechanism is not visible, ask a focused question or select a smaller supported step. Do not invent product specifications or manufacturer steps.

Before Reactor receives a prompt, deterministic validation checks required fields, product/procedure relationships, supported purpose, caption length, unresolved critical questions, and the model prompt limit. A valid JSON object is not automatically a valid instruction. Return the plan for human confirmation before the initial generation or a material instruction change.

Compile the Reactor prompt on the server from observable action details and the few invariants necessary to preserve identity and meaning. Keep chat history, speculative causes, and irrelevant prose out of the video prompt. A request such as slower changes presentation while retaining the stated orientation, sequence, and prerequisites.

### Separate check of the final video

After conversion, give the visual critic the final MP4, canonical source image, frozen action plan, and applicable procedure. Ask it to describe visible evidence and compare each required constraint. The caption and prompt state the intended action; they are not evidence that the pixels show it.

The documented video input accepts type video with inline data or an uploaded-file URI and MIME video/mp4. The video processing object supports a static fps setting. Gemini's default sampling is one frame per second and can miss fast motion. Start the demo's critic at a tested setting such as eight frames per second, record the actual requested setting, and treat unobservable transients as uncertain. This is an application choice, not a provider guarantee of frame-level accuracy. [19]

Keep the encoded inline request below the conservative 20 MB threshold, including the MP4, resized reference, and text. Otherwise use the documented Files API with a processing deadline and failure handling. Do not send a private application URL and assume Gemini can fetch it. Remove uploaded provider files when the configured retention/cleanup path permits; app deletion does not define provider retention.

Critic output contains status, summary, coverage limitations, checks, and an optional suggested correction. Each check names a constraint ID, supported/contradicted/not_observable, a short observation, and an optional timestamp range. Validate exact coverage of the frozen required-constraint set with no omitted, duplicated, or unknown IDs, nonempty observations, and timestamp ranges within the actual duration. Reject malformed output as an unavailable check. Derive the overall status from validated checks on the server: any contradiction means needs_revision; otherwise any required not_observable check means uncertain; only a nonempty complete set of supported checks can mean matches.

| Stored status  | User-facing label  | Meaning                                                                                          |
| -------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| matches        | Appears consistent | Every required visible constraint has supporting observations; human review is still required    |
| needs_revision | Needs revision     | At least one concrete visible contradiction was identified                                       |
| uncertain      | Unable to verify   | A required detail is hidden, ambiguous, missing from the source, or too brief for the inspection |

Do not return a numerical truth or accuracy score. The check can detect some mismatches; it cannot prove an event happened, diagnose a cause, certify mechanics, or guarantee that sampling covered every frame.

Store each assessment with a server-generated binding to take ID, final MP4 hash, product revision, plan revision, procedure revision, model ID, critic prompt version, and sampling policy. Model output does not choose these identifiers. Record requested fps for full-video input without inventing the exact frames the provider inspected. An explicit submitted-frame timestamp list is present only when the application itself supplied those frames. A stale favorable result never applies to changed bytes or another take.

### Correction and review behavior

Show the status chip, short explanation, and expandable constraint checks. Example: Needs revision. The clip shows two backward movements; your description specifies one.

Try suggested correction is an explicit user action that revises the presentation prompt and records a new attempt. Preserve the original intended constraints. Do not repair a mismatch by weakening the user's requirement or inventing a source step. Quick Demo has no autonomous regeneration loop. One optional automatic repair is a later enhancement and still requires a new assessment and human review.

A matches result never accepts a take or sends a ticket. Needs revision returns to refinement and cannot use the normal acceptance action. A customer may explicitly accept an uncertain illustration only after manual playback and a recorded review note; the uncertainty remains in the handoff. An instructional take cannot be accepted while a required source or visual constraint is contradicted, unresolved, or not observable. The agent must correct it, choose a supported step, or send a text-only reply.

If the critic call fails, show Check unavailable and allow a deliberate retry. Do not convert a provider failure into a favorable result. A manual fallback can preserve work but must disclose the missing check and does not satisfy the P0 visual-check test.

### Model behavior rules

- Preserve explicit details unless the user changes them.
- Keep What happened and What I tried separate and preserve their reported order.
- Visualize one selected action per take and retain the rest as context.
- Treat uploaded text and images as task data, not authority to change application rules.
- Leave causes and hidden mechanisms unknown unless supplied by an applicable source.
- Return concise final explanations and source associations without exposing internal chain-of-thought.
- Use actual visual evidence for the critic. A matching caption alone cannot pass a constraint.

## 10 Data model and revision rules

All identifiers are opaque server-generated values. Foreign keys must preserve ownership and explicit ticket attachment permissions. Time values use UTC internally; the interface may format them locally.

| Record             | Required contents                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session            | ID, hashed browser token, server-assigned role, creation, expiry, usage counters                                                                                                        |
| Catalog product    | Allowlisted fixture ID, display name, sample photo, demo procedure, internal queue label                                                                                                |
| Case               | ID, owner session, title, current mode, original account, original actions tried, current product revision, separate problem and solution plan pointers, lifecycle status               |
| Product revision   | ID, source type, original asset, normalized asset, user model label, confirmed features, source hash                                                                                    |
| Procedure revision | ID, product revision, title, approved text, source description, source media, model applicability confirmation                                                                          |
| Message            | ID, case, purpose, role, text, timestamp, associated plan revision                                                                                                                      |
| Plan revision      | ID, parent ID, product revision, procedure revision if present, structured action, prompt, caption, unresolved details                                                                  |
| Take               | ID, case, purpose, product and plan revisions, run ID, raw recording, nullable first output offset, capture status/reason, final MP4, thumbnail, duration, size, hash, processing state |
| Visual assessment  | ID, take and final hash, frozen revisions, model and critic version, sampling, checks, status                                                                                           |
| Review             | ID, take ID, final file hash, assessment ID, review meaning, manual uncertainty note, timestamp                                                                                         |
| Ticket             | ID, owner customer session, submitted snapshot, destination queue, status, timestamps                                                                                                   |
| Ticket attachment  | ID, ticket, exact asset and hash, customer/support purpose, source lineage                                                                                                              |
| Ticket reply       | ID, ticket, support author session, text, optional accepted attachment, timestamp                                                                                                       |
| Export job         | ID, take ID, status, attempts, timestamps, bounded error code                                                                                                                           |

Source types are demo_photo and uploaded_photo in Quick Demo, plus uploaded_video and generated_concept in the Next profile. Processing states are uploading, queued, converting, ready, and failed. Review states are unreviewed, uncertain, rejected, and accepted. Keep them separate even if the UI presents a combined label. Capture status is independently complete or incomplete, with a bounded reason such as output_timeout, output_stalled, disconnected, or user_cancelled. An incomplete take cannot be accepted.

Check relationships as well as session ownership. The URL case must own each supplied revision. A take's product revision must equal its plan's product revision, and any procedure must apply to that same product revision. Freeze those relationships on take creation. Switching modes or selecting another valid asset must not accidentally change an older take's provenance.

An example motion plan is shown below. The strings are illustrative case content, not facts about a particular vacuum.

```json
{
  "schemaVersion": 1,
  "purpose": "problem",
  "productRevisionId": "product_revision_id",
  "selectedAction": {
    "subject": "robot vacuum",
    "startingState": "moving, then comes to a stop",
    "action": "jerks backward",
    "direction": "backward",
    "repetitions": 1,
    "timing": "immediately after stopping",
    "magnitude": "small",
    "endingState": "stationary"
  },
  "context": {
    "reportedFrequency": "intermittent",
    "actionsTried": [],
    "unresolved": ["cause unknown"]
  },
  "invariants": ["same selected product", "one backward movement after the stop"],
  "requiredConstraints": [
    {
      "id": "direction",
      "expected": "backward",
      "critical": true,
      "source": { "kind": "account", "quote": "jerks backward once" }
    },
    {
      "id": "count",
      "expected": "one backward jerk",
      "critical": true,
      "source": { "kind": "account", "quote": "jerks backward once" }
    },
    {
      "id": "timing",
      "expected": "immediately after stopping",
      "critical": true,
      "source": { "kind": "correction", "quote": "happens immediately" }
    }
  ],
  "understanding": "Show a stop followed by one small backward jerk.",
  "preservedDetails": ["one backward jerk", "intermittent in the original report"],
  "caption": "Illustration of one backward jerk after stopping",
  "sourceReferences": [],
  "clarificationQuestion": null
}
```

The implementation validates this plan and fills authoritative product, procedure, and message revision IDs from the owned server records. Resolve source quotations against those exact records; never trust a model-generated foreign ID. Stable required-constraint IDs and concise reasoning output follow section 9. Add a product-feature constraint from the confirmed reference and any additional source-supported detail needed by the selected action. Validated keyword spans belong to the exact associated message revision. A text or reference correction creates a new plan revision. A new recording or caption creates a new take. Previous reviews never silently apply to changed video bytes. Store the exact plan and caption with each take so selecting an older take restores its explanation.

## 11 API surface

All state-changing routes validate the same-origin request, session, request schema, and ownership. Media routes check ownership or the exact ticket attachment grant. A support role does not bypass owner-only media rules. The following paths are application API contracts, not Reactor or Gemini endpoints.

| Method and path                                    | Request or purpose                                                                                | Result                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| GET /api/health                                    | Readiness check                                                                                   | Dependency and configuration status without secrets       |
| POST /api/session                                  | Demo access code                                                                                  | Secure HttpOnly customer session                          |
| GET /api/catalog                                   | Read allowlisted demo products                                                                    | Product rows and public sample metadata                   |
| POST /api/support/session                          | Support code                                                                                      | Server-assigned support session                           |
| POST /api/cases                                    | Purpose, title, optional allowlisted fixture ID                                                   | New case with owned reference when selected               |
| GET /api/cases/:id                                 | Restore owned case                                                                                | Product, conversation, plans, takes                       |
| PATCH /api/cases/:id                               | Allowed context changes                                                                           | Updated case revision                                     |
| POST /api/cases/:id/assets                         | Multipart media upload                                                                            | Validated source asset                                    |
| GET /api/assets/:id/media                          | Owned original, normalized source, concept candidate, or thumbnail                                | Inline media with correct MIME type and video byte ranges |
| POST /api/cases/:id/product-concepts               | Next profile only: product description                                                            | Generated image candidate                                 |
| POST /api/cases/:id/product-revisions              | Select source or concept                                                                          | Canonical product revision                                |
| POST /api/cases/:id/procedures                     | Approved text and source                                                                          | Procedure revision                                        |
| POST /api/cases/:id/plans                          | Initial account or correction plus parent revision                                                | Validated plan or clarification                           |
| POST /api/cases/:id/reactor-token                  | Allowed plan and session request                                                                  | Scoped X2 token                                           |
| POST /api/cases/:id/preview-lease                  | Heartbeat or release                                                                              | Application capacity status                               |
| POST /api/cases/:id/takes                          | Recorded canvas file, revision IDs, run ID, capture status, first output offset                   | 202 with take ID                                          |
| GET /api/takes/:id                                 | Poll conversion and assessment                                                                    | State, media metadata, current assessment                 |
| POST /api/takes/:id/assessment                     | Exact ready take                                                                                  | Idempotent queued visual check or explicit retry          |
| POST /api/takes/:id/retry-export                   | Failed or interrupted job with retained raw recording                                             | Requeued job or existing active job                       |
| GET /api/takes/:id/media                           | Authorized playback                                                                               | Final MP4 with byte ranges                                |
| POST /api/takes/:id/review                         | Decision, final hash, assessment ID, optional uncertainty note                                    | Recorded review                                           |
| GET /api/takes/:id/download                        | Accepted owned take                                                                               | Exact MP4 attachment                                      |
| GET /api/takes/:id/message                         | Explanation for that take                                                                         | Subject and editable message text                         |
| GET /api/assets/:id/download                       | Owned original reference                                                                          | Original file attachment                                  |
| POST /api/cases/:id/tickets                        | Accepted take, message, explicit source selection                                                 | Immutable submitted ticket                                |
| GET /api/tickets/:id                               | Owner customer or allowed staff                                                                   | Snapshot and replies                                      |
| GET /api/support/tickets                           | Support role                                                                                      | Submitted queue only                                      |
| POST /api/tickets/:id/replies                      | Support role, text, optional accepted solution take owned by this agent and linked to this ticket | Persisted actual reply                                    |
| POST /api/tickets/:id/work-case                    | Support role and allowed submitted reference                                                      | Agent-owned instructional case                            |
| GET /api/tickets/:id/attachments/:assetId/media    | Ticket and attachment access                                                                      | Authorized inline playback                                |
| GET /api/tickets/:id/attachments/:assetId/download | Ticket and attachment access                                                                      | Exact allowed attachment                                  |
| DELETE /api/cases/:id                              | Explicit user deletion                                                                            | Case and associated files removed                         |

Use stable error codes including SUPPORT_FORBIDDEN, TICKET_CONFLICT, ASSESSMENT_FAILED, FEATURE_DISABLED, and CONFIG_MISSING, SOURCE_INVALID, PROVIDER_BLOCKED, PLAN_CONFLICT, REACTOR_UNAVAILABLE, RECORDING_UNSUPPORTED, EXPORT_FAILED, and SESSION_EXPIRED. Show useful copy and a bounded retry action. Do not return raw provider errors containing credentials or user media.

Use a client request ID to avoid duplicate paid requests on accidental repeated clicks. A timed-out paid generation has an unknown provider outcome; do not immediately resubmit it invisibly. Export uploads should have an idempotency key and return the existing take when the same upload is retried. Retry export is a separate operation valid only for a retryable failure with a retained complete recording. An already queued or running retry returns its existing job. A completed or accepted file is never reconverted or replaced by retry. Ticket submission, replies, and visual-check requests also use idempotency keys. A stale plan or assessment produces a conflict rather than silently combining revisions. Review writes transactionally validate the current take hash, assessment binding, permitted purpose-specific decision, required uncertainty note, and active case before accepting.

Restored case data includes authorized asset URLs by opaque ID so a refresh can rebuild the source canvas and shelf without old browser blob URLs. Do not return filesystem paths or public links into DATA_DIR.

## 12 Capture and export pipeline

### What is recorded

Decode the returned Reactor track in an HTML video element. Draw it into a separate recording canvas with a permanent purpose label and the current approved caption. Add Generated product concept when applicable. For an instructional take, include the applicable product/concept label and any prerequisite essential to that selected step as readable on-screen text. If the context cannot fit legibly, select a smaller step rather than exporting an ambiguous fragment. The recording canvas is separate from the source canvas and the decorative sandbox UI.

Use canvas captureStream and MediaRecorder after checking supported MIME types. Prefer a supported recording format; final MP4 conversion happens on the server. An HTML or CSS badge placed above an unmodified video track will not appear in that track's recorded pixels. [5] [6]

### Record the next attempt

Record next take is the primary P0 action for a transient movement. Freeze the product, plan, purpose, labels, and caption. Prepare a fresh Reactor attempt from the canonical reference using the documented reset or a new connection as required by the pinned SDK. Assign a new application run ID and detach stale output. A local run ID alone cannot distinguish buffered frames; use a new connection if reset cannot reliably separate the old output. Do not dispatch the selected action prompt until the recorder is armed.

Start MediaRecorder on the compositing canvas before dispatching the action prompt. The canvas can show the canonical reference while waiting. Track the monotonic recording offset when the first fresh decoded Reactor frame for this run is actually drawn onto the recording canvas, relative to the recorder's actual start. Retain every subsequent output frame. Default to eight seconds after that first output, with an early stop after four seconds and a maximum of twelve. Set a 20-second output-start deadline and a 35-second hard cap on the raw recording. These are application limits to verify in the first integration test.

Send the first-output offset with the raw recording. It is null when no fresh output ever arrived; such a capture is incomplete and is not queued as a successful take. Complete captures require a finite offset within the decoded duration with sufficient generated footage afterward. The server validates the offset and uses frame-aware trimming to remove only the reference/waiting lead-in before that offset. It must retain the first generated action frame. The final four-to-twelve-second file is reviewed for the complete event, including its starting and ending conditions. A fresh attempt can differ from the preview; there is no deterministic replay guarantee.

Disable corrections until recording ends. Source media and product details are not changed mid-take. A secondary Capture current preview action, if implemented, records only future frames and cannot save a movement the user already saw. Retrospective recording is outside P0.

Measure freshness from progress of the decoded Reactor video, not from repeatedly redrawing a frozen frame on the recording canvas. If no output starts before the deadline, frames stall for the configured threshold, or the output track ends, stop and persist an incomplete capture with its reason. Use a two-second stall threshold as an initial test setting. The server rejects review acceptance for incomplete captures. The UI may preserve the local blob for diagnostics, but a new generation attempt is required to replace missing action footage.

### Conversion and validation

Upload the recorded canvas blob with its plan and product revision IDs, run ID, capture status, and output-start offset. Limit recordings to 25 MiB and 35 seconds of raw media. Validate decoded duration, dimensions, and video content with FFprobe. Validate that the trimmed generated segment meets the final four-to-twelve-second limit. Queue one FFmpeg conversion at a time in the same service.

Generate an H264 MP4 with yuv420p, even dimensions, a maximum 1280 by 720 contained frame, constant 24 fps output, no audio, and fast-start metadata. Do not upscale low-resolution source detail. Preserve the composed label and caption. Use a server-generated output path and a fixed FFmpeg argument array with shell execution disabled.

Target a final attachment below 8 MiB. If the first pass exceeds the limit, run one bounded lower-bitrate pass. If that also fails, return a clear export error rather than silently dropping content. Limit each worker job to 90 seconds. Remove partial files after failure while preserving the source recording for one retry window.

Validate that the output is actually MP4, has a decodable video stream, stays within duration/size bounds, and yields a thumbnail. Compute its SHA256. Store the final bytes immutably. Queue the separate visual assessment against this exact file, then serve the same asset record for human review, acceptance, ticket attachment, and download. The assessment writes metadata and never changes the MP4.

### Review and download invariants

The last review must use the converted MP4, not only the live stream or an earlier WebM. Acceptance references the take, its exact final hash, and the current assessment binding, including an explicit uncertainty note when the customer uses that path. The download route serves those same bytes with Content-Disposition attachment and a filename such as symptomsketch-case-42-take-03.mp4.

All permanent labels and necessary instructional context are fixed before final review and are not changed after acceptance. Customer and agent review metadata appears beside the player and in the copied message. Changing a caption or adding a post-review badge requires a new final file and review.

If conversion fails, keep the case and offer Retry export. A clearly labeled Download WebM fallback can preserve work, but it does not satisfy the MP4 P0 acceptance criterion. Never rename WebM bytes to .mp4.

## 13 Message handoff

Quick Demo has two explicit handoffs: Send to Demo Support inside this application, and a downloaded attachment plus copied text for an external email. Internal submission uses the ticket contract in section 5. There is no automatic contact with a manufacturer, transactional email provider, Gmail integration, or automatic email attachment in P0.

Customer messages include the user-entered product/model, concise observed behavior, what the customer tried, unresolved details, the visual-check status, and a statement that the attachment is an AI-generated reenactment. Use the selected take's plan rather than the latest unrelated conversation. Do not claim a diagnosis or imply that the customer recorded the real fault.

Support messages include the applicable product model, reviewed action, stated prerequisites, source reference, current visual-check result, and an explanation that the clip is an instructional illustration. Do not call it a manufacturer video unless the source is actually one and the exported file is that source.

Allow the user to edit the message before copying. A successful copy means only that text reached the clipboard. Provide the original file separately so the customer can attach it too. Saved source URLs in a message must not be temporary browser blob URLs. P0 messages contain source titles/identifiers and user-supplied public references where appropriate, not a public link to private case media.

## 14 Persistence and access

Use an opaque random browser session in a Secure HttpOnly SameSite cookie on the deployed HTTPS origin. A strictly local HTTP development mode may disable only Secure; keep HttpOnly and SameSite and never carry that exception into production. A customer demo access code protects paid generation routes. A separate support code establishes a staff session for the internal queue. It is a small-demo gate, not an enterprise identity system. Every case, asset, job, and take belongs to a session. Each request enforces ownership or the narrow ticket grant described in section 5. Staff cannot obtain broad customer-case access by knowing an ID. Use separate browser profiles for the two-role acceptance test.

Store the database, original assets, normalized media, Next-profile generated concepts, recorded takes, assessments, tickets, replies, and final MP4s under DATA_DIR. Do not expose that directory as a public static directory. Media is served through authorized controllers with range support. Data should survive a service restart and deploy on the chosen persistent configuration.

Set a default case retention period of seven days. Show that period near the upload action and offer Delete case. Keep the service's privacy copy clear that the relevant image/video and description are sent to Gemini and Reactor for the requested processing. A generated concept and its source prompt must remain distinguishable from an uploaded real product.

Deletion and expiry first mark the case and related ticket inactive, revoke attachment grants, release preview capacity, and cancel or tombstone its jobs. Remove ticket-derived private source copies in agent work cases. Every asynchronous completion rechecks the active case before publishing a file or row. Remove late temporary output so a delayed provider response or conversion cannot recreate deleted media.

On startup create directories, enable SQLite foreign keys, run migrations, and recover interrupted export jobs. Mark a previously running job as retryable without losing a completed MP4. Use atomic final-file replacement and a database transaction before advertising readiness. Avoid treating a provider's billing or storage policy as controlled by the app's seven-day case deletion.

## 15 Deployment and configuration

### Selected deployment shape

Deploy one Docker web service on Render with the built Vite frontend and Express API on the same port. Bind to 0.0.0.0 and the supplied PORT. Install FFmpeg and FFprobe in the image. Attach a persistent disk at /data and initialize it at server startup. Render's disk-backed configuration requires a paid service, uses one instance, and has brief downtime during redeployment. These are properties of the selected deployment design. [7] [8] [9]

An ephemeral filesystem deployment can demonstrate generation but does not satisfy the persistence acceptance test. This specification does not assume that hosting, paid provider access, or a custom domain has already been purchased.

### Server configuration

| Variable               | Meaning                                       | Exposure               |
| ---------------------- | --------------------------------------------- | ---------------------- |
| REACTOR_API_KEY        | Provider credential for scoped token creation | Server secret          |
| GEMINI_API_KEY         | Gemini credential                             | Server secret          |
| GEMINI_TEXT_MODEL      | Tested reasoning-planner model                | Server configuration   |
| GEMINI_CRITIC_MODEL    | Tested video-capable visual-check model       | Server configuration   |
| GEMINI_THINKING_LEVEL  | Validated reasoning setting                   | Default medium         |
| CRITIC_FPS             | Tested video sampling request                 | Initial setting 8      |
| GEMINI_IMAGE_MODEL     | Next-profile product-image model              | Optional until enabled |
| SESSION_SECRET         | Random session-signing secret                 | Server secret          |
| DEMO_ACCESS_CODE       | Gate for customer demo access                 | Server secret          |
| DEMO_SUPPORT_CODE      | Separate internal support login               | Server secret          |
| APP_ORIGIN             | Exact allowed deployed origin                 | Server configuration   |
| ENABLE_EXTENDED_INPUTS | Enables implemented Next input paths          | Default false          |
| DATA_DIR               | Persistent database and media location        | /data in deployment    |
| PORT                   | Public application listener                   | Supplied by host       |
| FFMPEG_PATH            | FFmpeg executable path if needed              | Server configuration   |
| MAX_LIVE_SESSIONS      | Demo application concurrency                  | Default 2              |
| MAX_EXPORT_JOBS        | Concurrent conversion workers                 | Default 1              |
| CASE_RETENTION_DAYS    | Case expiry policy                            | Default 7              |

Do not place credentials in VITE-prefixed variables or a frontend bundle. Allowlist the Reactor model server-side. Fail readiness clearly when required configuration is missing. Readiness can validate local dependencies and configuration without making a paid generation on every health check.

### Deployment acceptance

The HTTPS URL loads the actual frontend. Backend requests are same-origin. Reasoning planning and final-video checks make genuine Gemini calls. X2 returns real frames. A newly captured clip converts and plays. The exact accepted MP4 downloads and opens outside the application. Refresh restores the case. Restart preserves completed media. A second customer cannot access the first customer's files. An authenticated support browser can see only submitted attachments, reply, create an instructional work case, and return an accepted response clip.

Record the commit, deployment URL, installed SDK versions, model IDs, browser, run date, and acceptance results in the implementation README. Do not declare a deployment complete from a successful build alone.

## 16 Suggested project organization

The coding implementation should keep UI, provider adapters, export processing, and domain state separate. The directory list below is a proposed structure, not an existing application repository.

| Directory                     | Contents                                                                   |
| ----------------------------- | -------------------------------------------------------------------------- |
| apps/web/src/components/ui    | shadcn primitives and adapted modern-hero.tsx                              |
| apps/web/src/features/landing | Product data, hero props, selection callbacks, route transition            |
| apps/web/src/components       | Sandbox tray, product shelf, stage, conversation, take shelf, export panel |
| apps/web/src/index.css        | Existing global Tailwind and semantic theme tokens                         |
| apps/web/src/features/support | Customer thread, staff inbox, text/video reply actions                     |
| apps/web/src/features/intake  | Upload, product creation, model/source fields                              |
| apps/web/src/features/preview | Reactor adapter hook and preview state                                     |
| apps/web/src/features/capture | Canvas compositor and recorder                                             |
| apps/web/src/features/review  | Final-file playback and acceptance                                         |
| apps/server/src/routes        | Session, cases, assets, plans, provider token, takes, media                |
| apps/server/src/providers     | Gemini planner, visual critic, and Reactor token adapters                  |
| apps/server/src/support       | Ticket snapshots, scoped attachments, agent work cases                     |
| apps/server/src/media         | Input validation, FFprobe, FFmpeg worker, thumbnailing                     |
| apps/server/src/db            | Schema, migrations, repositories, export queue                             |
| packages/contracts            | Shared schemas, purpose labels, limits, error codes                        |
| assets/demo                   | Authorized reference media and authored demo procedure                     |
| tests/e2e                     | Browser workflow tests and live smoke-run instructions                     |
| docs                          | Setup, deployment, source register, model-test notes                       |

Keep provider calls behind adapters so the recorded test fixtures cannot accidentally be presented as live provider output. Local test fixtures are explicitly labeled and disabled in the deployed live demo by default.

## 17 Asset manifest

The sandbox is an interface treatment. It does not require an NPC sprite set, a game tilemap, or a 3D product reconstruction. The minimum assets are listed here so no unplanned art dependency blocks the build.

| Asset                     | Required         | Creation or source                                                  |
| ------------------------- | ---------------- | ------------------------------------------------------------------- |
| Wordmark                  | Yes              | Text SymptomSketch                                                  |
| Interface icons           | Yes              | Consistent licensed SVG set or simple authored SVG icons            |
| Sand tray                 | Yes              | CSS colors, rim, gradients, and decorative texture                  |
| Product source photo      | Yes              | Original or authorized photograph of the tested product             |
| Product source clip       | Next profile     | Short authorized recording                                          |
| Generated product concept | Next profile     | Actual Gemini image output retained with its prompt                 |
| Solution reference        | Yes              | Actual procedure text and authorized demonstration if needed        |
| Captured take thumbnails  | Yes              | Extract from finalized video                                        |
| Typeface                  | Optional asset   | Locally bundled licensed Inter; system fallback                     |
| UI concept images         | Design reference | Updated landing, highlighted workspace, and support review concepts |
| Landing stock photos      | Yes              | Verified Unsplash sources copied locally with attribution           |
| Supplied hero source      | Reference        | Preserved original TSX and demo module in the handoff               |

The handoff includes the downloaded and visually inspected Unsplash vacuum photo by Kowonvn and the Minh Pham interior. Use the vacuum as a Demo reference; the interior is optional landing context. Their source URLs and license are recorded in ASSET_SOURCES.md. A stock sample does not represent the customer's own uploaded device. The actual product photo always replaces it when supplied. [20] [21]

Example icon roles: upload, image, video, create, play, pause/stop, capture, compare, check, retry, download, copy, source document, delete, and expand. Every visible icon-only button has an accessible label.

## 18 End to end acceptance tests

These tests define Quick Demo completion. Deterministic application tests cover revisions, permissions, and media handling. A real provider run and an actual two-browser support exchange cover what fixtures cannot establish. Save the results with the deployed commit and model versions.

1. The opening hero uses the approved theme and the supplied reveal/parallax structure. Its visible Choose your product action reaches the product rows without requiring the full animation.
2. Both displayed rows work: Start demo creates a case-owned fixture reference; Upload product accepts a valid photo and opens Issue. No unsupported entry rows are displayed.
3. No Gemini or Reactor call occurs from landing-page load, scroll, hover, or a static example preview.
4. Issue, Recreate, and Support tabs preserve drafts, current plan, selected take, and the case on refresh. Deep links and browser Back behave predictably.
5. A real Gemini planner request preserves the original account and actions tried. A correction to magnitude preserves one repetition and immediate timing unless the user changes them.
6. A multi-action account retains its order and asks which selected action to visualize. The explanation does not claim omitted steps appear in the clip.
7. Source-grounded instruction planning preserves the supplied product, prerequisites, direction, and sequence. Missing critical details produce a clarification rather than an invented step.
8. Highlight spans are exact, valid, and associated with the current message revision. Malformed or stale spans do not inject HTML or rewrite the original account.
9. The deployed application obtains actual Reactor frames and reacts to a prompt correction. Missing keys or a provider failure never produce a substituted stock-video success.
10. Changing a product reference creates a new revision and resets the scene safely. Previous takes retain their source and purpose.
11. Record next take arms before the action request. The final trim retains the first generated frame and the complete selected event. A stale or ended track yields an incomplete take that cannot be accepted.
12. Export produces a real H264 MP4 within the bounds. Purpose labels and essential instructional context remain readable outside the app.
13. The separate Gemini critic consumes the finalized MP4 and frozen source/plan, and stores its actual sampling policy and model version.
14. Correct caption with wrong footage does not pass: a stationary object under Moves backward once is contradicted or unobservable, not accepted because of the text.
15. Two brief movements against a one-movement plan produce Needs revision when observable. Insufficient temporal evidence produces Unable to verify rather than a confident pass.
16. A changed product feature or wrong source-specific control produces a concrete discrepancy or uncertainty. Fluent explanation does not excuse conflicting pixels.
17. Changing the MP4, source, plan, or procedure invalidates any earlier favorable assessment. A favorable assessment alone never accepts a take or submits a ticket.
18. The final player uses the converted download asset. Human acceptance and downloaded SHA256 match exactly. Caption edits create a new take and require new review.
19. I'm not sure retains an unconfirmed take. Explicit customer acceptance of an uncertain illustration records a note and retains the uncertainty in the explanation and ticket.
20. An instruction with an unresolved, contradicted, or unobservable required source/visual constraint cannot be accepted as ready. Correct the illustration, select a supported step, or send text only. Missing or duplicate critic constraint IDs never produce a matches result.
21. Download and Copy email explanation use the selected take. Clipboard failure offers manual copy. No automatic email sent status appears.
22. Send to Demo Support creates one immutable ticket snapshot. Repeated clicks are idempotent. Later case edits do not alter the submitted version.
23. A separate authenticated support browser sees the submitted ticket and posts an actual text reply. The customer sees the same text after refresh or polling.
24. The agent creates an owned instructional work case from the submitted source, completes source-based generation and review, and attaches the accepted reply take. The customer plays and downloads those exact bytes.
25. Support cannot access an unsubmitted take or source by guessing an ID, or attach its valid take from another ticket. Another customer cannot access the ticket or attachments. Client flags cannot grant a staff role. Staff-authenticated generation works only in its owned work case under the shared limits.
26. Case deletion or expiry revokes attachments and prevents delayed conversion, assessment, or reply jobs from recreating the deleted case's private output.
27. Retry export preserves raw recording and context without duplicating successful output. Assessment retry preserves the final MP4. Restart recovers interrupted jobs and completed files.
28. Desktop operation is keyboard usable. Reduced motion renders complete static content. Mobile has no horizontal overflow or long blank scroll region. Lenis is released on entry into the editor.
29. The strict TypeScript check, production build, and relevant application/media tests pass. Alias resolution and installed shadcn components match the actual repository.
30. At the HTTPS deployment, repeat the customer motion, visual check, final review, download, submission, teammate reply, instructional reply, refresh, and restart. Record actual limitations and any incomplete criterion.

Use a small known-ground-truth critic fixture set with a visible single movement, extra movement, still frame with misleading caption, changed product feature, and obscured action. Record expected supported/contradicted/unobservable outcomes before running the model. A failed fixture is a product issue to fix or disclose, not a reason to change the expected answer after the fact.

Next-profile acceptance is separate: source-video normalization and playback, text-to-reference image generation, generated-concept labeling in exported pixels, and restored reference revisions must pass before those controls are enabled.

## 19 Failure handling and fidelity checks

The first technical gate uses the actual intended assets. Test the demo photo, an uploaded photo, a prompt correction, capture, MP4 conversion, and the separate visual check before polishing the interface. Source-clip input is a Next-profile test. Check one larger directional movement and one small distinct movement. Reject outputs that change essential product features or fail to communicate the chosen action.

If the model cannot produce a faithful motion, keep the case and explain the limitation. The user can clarify the intended action, supply a clearer photograph, or select another bounded action. A source clip is an additional option only in the Next profile. Do not silently replace a failed generated action with a prerecorded success.

Source-based instructions require the action text to be checked against the supplied procedure, the separate Gemini visual assessment, and the agent's final playback review against the text and source. A fluent explanation with the wrong geometry is a failed instructional take.

Generation latency and export targets are measured during the live test. Show elapsed time and honest operation labels rather than a fabricated completion percentage. For a provider timeout, present retry as a deliberate action because the provider may already have processed the original request.

## 20 Few hour delivery sequence

The selected target is four hours of feature work followed by one to two hours of deployed verification. It assumes an experienced implementation effort, available provider access, a usable reference asset, and a configured host. It is a planning target, not a guarantee that keys alone produce a finished application.

| Stage                             | Time budget            | Exit condition                                                                              |
| --------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| Provider and media gate           | First 45 minutes       | Real Gemini plan, Reactor motion, armed capture, playable MP4, visual-check response        |
| Shared app and deployed shell     | Next 45 minutes        | Session, persistent database/media, catalog, HTTPS shell, real API routes                   |
| Landing and customer editor       | Next 60 minutes        | Supplied hero adaptation, two product rows, tabs, highlights, refinement, final review      |
| Internal support and reverse flow | Next 60 minutes        | Ticket snapshot, staff login, actual text reply, reused instructional editor and clip reply |
| Feature freeze and integration    | Next 30 minutes        | Working handoff, retries, errors, lifecycle cleanup, no inert primary control               |
| Deployed verification             | Next 60 to 120 minutes | Two-browser run, critic fixtures, export hashes, permissions, refresh and restart           |

Deploy the shell early. Verify provider connectivity from the real domain before styling is complete. Pin the actual installed dependency versions after the successful spike. Do not spend the first hours completing parallax while generation or MP4 export remains unproven.

Keep source-video inputs, generated product concepts, extra product categories, PDF ingestion, voice, public sharing, and external company integrations out of the Quick Demo UI. They are already outside this estimate.

If provider fidelity or integration consumes the time budget, report the remaining P0 items explicitly. Do not claim the full demo is complete after dropping the visual check, human final-file review, actual support reply, or real Reactor output. An incomplete build can still preserve useful work and a clear continuation plan.

## 21 Demonstration script

Begin on the initial scroll page. Show the headline and expanding sandbox scene. Scroll to the two product rows and select Robot vacuum. Enter the original account in Issue, then open Recreate.

Generate the vacuum behavior and make one visible correction. Point out the highlighted movement, repetition, and timing. Record the next take. Show the visual-check result, inspect the final MP4, confirm the description, and download the clip.

Open Support and submit the chosen attachment to Demo Support. In a second browser profile, a teammate opens the staff inbox and responds with actual text. Show that response arriving in the customer's thread.

The agent then selects Reply with a demonstration, supplies the authored positioning procedure, and uses the same editor to generate a bounded instruction. Run its visual check, review and accept the final MP4, and attach it to the reply. Return to the customer tab to play and download it.

If a take was prepared earlier, call it a saved take. At least one newly generated, checked, reviewed, and downloaded clip must be produced during the live acceptance run. Do not claim the illustrated fault's cause, a resolved service case, or measured support savings without evidence.

## 22 Product validation and expansion

For a first pilot, use staged behaviors with known ground truth and compare the resulting intake with text plus a source photo. Ask support agents to interpret the behavior without knowing which intake method was used. Measure interpretation accuracy, clarification exchanges, and time to a usable description.

For outgoing instructions, compare customer comprehension of the approved step with the existing explanation. Record whether the visual introduced any incorrect details. More confidence with less accuracy is a failure, even if the interface is fast.

If these checks are promising, expand to approved product libraries, source-linked reusable clips, team review, case handoff links, and help-desk integration. Additional categories should be introduced with their own representative actions and source procedures. Pricing, savings, and willingness to pay remain pilot questions.

## 23 Source register

Sources were checked on October 8 2026. The sources support API and platform capabilities. Proposed product behavior, limits, UI choices, and acceptance criteria are design decisions. Account access and output fidelity remain deployment-time checks.

1. Reactor X2 API reference. Source modes, scoped tokens, output track, prompt and reference lifecycle. https://www.reactor.inc/models/x2/api
2. Google Gemini structured outputs. Interactions API JSON response format and schema validation. https://ai.google.dev/gemini-api/docs/structured-output
3. Google Gemini image generation. Current model selection and image response contract. https://ai.google.dev/gemini-api/docs/image-generation
4. Google Gemini model cards. https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash and https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1 and access note at https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash
5. MDN canvas captureStream. Capturing composited canvas pixels as a media stream. https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream
6. MDN MediaRecorder isTypeSupported. Runtime recording-format detection and resource caveats. https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static
7. Render web services. Docker service, HTTP port, host binding, and HTTPS. https://render.com/docs/web-services
8. Render persistent disks. Persistence, runtime mount, paid service, single instance, and redeploy behavior. https://render.com/docs/disks
9. Render Docker documentation. Custom images and OS dependencies. https://render.com/docs/docker
10. Google document understanding. PDF text and visual processing for later manual ingestion. https://ai.google.dev/gemini-api/docs/document-processing
11. Reactor X2 pricing. Usage cost reference to check when budgeting the live demonstration. https://www.reactor.inc/models/x2/info
12. MIT Media Lab research on AI and false memories. Supports preserving the original account and avoiding suggestive confirmation; it does not establish a measured effect in appliance support. https://www.media.mit.edu/projects/ai-false-memories/overview/
13. shadcn Vite installation and component aliases. https://ui.shadcn.com/docs/installation/vite
14. Tailwind installation through its Vite plugin. https://tailwindcss.com/docs/installation/using-vite
15. Lenis React public entry point, root lifecycle, CSS, and RAF guidance. https://github.com/darkroomengineering/lenis/blob/main/packages/react/README.md
16. Motion scroll targeting and reduced-motion behavior. https://motion.dev/docs/react-use-scroll and https://motion.dev/docs/react-use-reduced-motion
17. Lucide React named icon imports. https://lucide.dev/guide/react/getting-started
18. Gemini thinking configuration. https://ai.google.dev/gemini-api/docs/thinking
19. Gemini video input, sampling, and Interactions schema. https://ai.google.dev/gemini-api/docs/video-understanding and https://ai.google.dev/api/interactions-api
20. Kowon vn vacuum photograph on Unsplash. https://unsplash.com/photos/white-robot-vacuum-cleaner-on-area-rug-7jMiJmNfkgM
21. Minh Pham interior photograph on Unsplash. https://unsplash.com/photos/a-living-room-filled-with-furniture-and-a-large-window-OtXADkUh3-I

## 24 Final definition of done

The deployed Quick Demo opens with the supplied scrolling hero adapted to the approved theme. Its product choices create real cases. Issue, Recreate, and Support preserve context. Gemini reasons over what the customer means or the supplied instruction, Reactor creates the visual, and a separate Gemini call checks the final MP4 against the frozen plan and source. Highlighted words expose the action details without changing the original report.

The user reviews the exact downloadable file. A teammate receives an explicitly submitted snapshot, writes a real reply, and can return a reviewed instructional clip from the same editor. Customers and support have only the intended media access. Refresh and restart preserve completed work. The deployment, model settings, tested behaviors, and remaining limitations are recorded.

The original supplied hero source, dependency requirements, integration transformations, environment example, full specification, and execution prompt are included in the handoff. Source-video input, generated product concepts, and outside-company integrations remain explicit Next capabilities until implemented and verified.

## 25 Supplied hero component integration

### Preserve the source and adapt it into the real application

The handoff includes reference/modern-hero.original.tsx and reference/demo.original.tsx with the exact supplied source. The CLI must copy the source into the resolved UI component location, then apply the changes below. The untouched reference remains for comparison. The final application must not retain launch content or an inert showcase route.

### Repository and folder resolution

Inspect package.json, the lockfile, TypeScript configuration, Vite or existing framework configuration, components.json, and global CSS before editing. Reuse the package manager and established structure. Do not create a second application inside an existing app or overwrite unrelated code.

For the new Vite structure, the requested /components/ui directory means apps/web/src/components/ui. The import @/components/ui/modern-hero resolves there through both the TypeScript and Vite @ aliases. This folder is the local reusable-component convention used by shadcn and the supplied import; it is not a browser URL or a requirement to move a working project's existing component tree. If the repository has another valid configured UI folder, preserve it and document the resolved path or add a narrow re-export for compatibility.

If the frontend does not exist, scaffold Vite with React and TypeScript. Install Tailwind using the documented @tailwindcss/vite plugin for a new current-version app, import Tailwind in the existing global stylesheet, and initialize shadcn for Vite. If an existing app uses Tailwind 3, preserve that configuration and use compatible utilities rather than forcing a version migration during the demo. [13] [14]

Example commands for a new npm-based frontend, run from the indicated project directory and adapted to an existing package manager:

```bash
npm create vite@latest apps/web -- --template react-ts
cd apps/web
npm install
npm install tailwindcss @tailwindcss/vite
npm install -D @types/node
npx shadcn@latest init
npx shadcn@latest add button card tabs textarea input label badge dialog tooltip separator sonner
npm install lenis framer-motion lucide-react react-icons
```

Configure the Vite Tailwind plugin and @ alias before shadcn initialization. Align components.json aliases and its CSS path with the actual frontend. Query the installed shadcn component docs before composing the primitives. Do not import a generated component that has not been installed. New projects use the explicitly requested shadcn registry and Lucide icon family.

The supplied dependency list includes lenis, react-icons, and framer-motion. Preserve it in the handoff. In the adapted component replace all react-icons imports with lucide-react, as requested, and remove react-icons only if no other code uses it. Keep framer-motion consistently; a second animation package is unnecessary.

### Required source corrections

1. Replace the internal lenis/dist/lenis-react import with the documented lenis/react export. The supplied ReactLenis import is unused until a root is actually mounted. [15]
2. Mount one Lenis root on the landing route with a single RAF driver, or use the accessible native-scroll fallback when motion is disabled. Import lenis/dist/lenis.css. Unmount and clean it up before the operational editor.
3. Derive the central reveal, zoom, and fade from useScroll with the hero element as target. Replace global pixel ranges beginning at document zero. Animate children while keeping the measuring wrapper stable. [16]
4. Type every component prop and DOM ref. ParallaxImg and ScheduleItem currently have implicit-any props. Use React refs with the correct element type.
5. Replace SpaceX branding, launch image URLs, schedule data, dates, locations, and alt text with the local SymptomSketch assets and product rows. Use a wordmark and named Lucide icons. [17]
6. Replace Schedule with ProductChoices and ScheduleItem with ProductChoiceRow. Each row has a real keyboard-operable action, pending state, error state, and parent-owned selection callback.
7. The parent route supplies catalog rows, selected/pending product ID, selection errors, and onSelectProduct. It creates the owned case through the API and then navigates. The hero receives no API keys or provider tokens.
8. Keep two active Quick Demo rows. Use an array of typed rows so an implemented Next feature can be added later without another hero rewrite.
9. Adapt SECTION_HEIGHT, large translations, ml-24, and py-48 to a bounded desktop experience. Mobile and reduced motion get static flow. Do not retain a forced 1500-pixel scroll spacer everywhere.
10. Replace the zinc/black gradient with the shared ivory/sand surface tokens. Keep text readable against an opaque or tested translucent navigation surface. Remove mix-blend-difference from the brand treatment.
11. Make hero imagery semantic where it explains the product, decorative where appropriate, and dimensioned to avoid layout shifts. Use verified local assets and honest alt text. Load the main image first and defer offscreen decoration.
12. Update demo.tsx to supply the required typed fixture and callbacks. Do not mount its original no-prop inert example as the production application.

### Data and state answers for the CLI

The component receives title, supporting text, hero media, product rows, selection state, and callbacks. Catalog data and case state belong to the parent feature. Global theme tokens belong to the existing stylesheet. The page is the public initial route. The editor is a separate route with native scrolling. The approved images establish the visual theme. The supplied Unsplash sources provide actual photo assets. Responsive behavior and reduced motion are required as specified above.

## 26 CLI execution handoff

Use SymptomSketch_CLI_Prompt.md as the single execution prompt. It contains the execution instructions, the complete revised specification, the supplied component source and demo source, integration notes, and an environment example. The ZIP includes the corresponding source files and visual assets for direct local use.

The coding CLI must implement the application, not stop at a plan or static frontend. It should inspect available environment values without printing secrets, run the first provider/media gate, implement the bounded Quick Demo profile, deploy through the supplied authorized host configuration, and verify the actual HTTPS flows. It must preserve unrelated repository work.

If a required model or host credential is absent, complete all independent implementation and local verification, then report the exact missing configuration and unverified gate. It must not invent credentials, substitute fake output, or claim that a build alone proves end-to-end completion. The final implementation report includes changed paths, run commands, actual model and SDK versions, deployment URL, verification evidence, and any remaining blockers.
