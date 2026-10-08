# SymptomSketch: repo instructions

Hackathon build (Reactor x Google World Models Hackathon, NYC, 2026-10-08). Customers show support
what a product did; support shows customers the right way to do a step. Gemini plans and checks;
Reactor X2 makes the moving visual; the human reviews the exact MP4.

## Source of truth

- Product + build spec: `docs/spec/SymptomSketch_Build_Spec.md` (Quick Demo profile = P0). Section
  numbers below (`spec 9`) point into it.
- Shared types, schemas, limits, error codes: `packages/contracts` (zod). Server and web import from
  `@symptomsketch/contracts`. Change a contract here first, never fork a shape locally.
- Provider facts verified live: `docs/providers/*.md`. Do not guess SDK method names; read the
  installed `.d.ts` in `node_modules/@reactor-models/x2` and `node_modules/@google/genai`.
- Coordination between parallel agents: `BOARD.md` (append-only, see its header).

## Layout

| Path                                                  | Owns                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `apps/web`                                            | Vite + React 19 + TS strict + Tailwind v4 + shadcn (`src/components/ui`)  |
| `apps/web/src/features/*`                             | landing, intake, workspace, preview (Reactor), capture, review, support   |
| `apps/server`                                         | Express 5 + TS run by tsx; `node:sqlite`; sharp; ffmpeg/ffprobe via spawn |
| `apps/server/src/{routes,providers,media,support,db}` | per spec 16                                                               |
| `packages/contracts`                                  | zod schemas + TS types shared by both apps                                |
| `assets/demo`                                         | demo fixture photos + authored demo procedures (server-side fixtures)     |
| `reference/`                                          | untouched original supplied hero + demo source (do not edit)              |

## Commands (run from repo root)

- `pnpm dev`: server on :3030 + Vite on 127.0.0.1:5173 (proxies `/api`).
- Gates, all must pass before any commit: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- `pnpm format` fixes prettier drift. shadcn primitives in `src/components/ui` are prettier-ignored
  except `modern-hero.tsx`.

## Hard rules

- Secrets live only in the gitignored root `.env` (loaded by `apps/server/src/config.ts`). Never print,
  log, echo, or commit key values, tokens, or JWTs. Log status codes / error codes only. Never use
  `VITE_` for any secret. The browser gets only short-lived Reactor JWTs from `/api/cases/:id/reactor-token`.
- Real providers only. Never substitute a stock clip or fixture output for a Reactor/Gemini result
  and call it live (spec 2, 19). Test fixtures are labeled and never served by the live app.
- Commits: imperative subject <= 70 chars + a why body, via `git commit -F <file>`. NO AI attribution
  of any kind (no Co-Authored-By, no Claude-Session trailer, no session URL). ron2k1 is sole author.
- Never `taskkill /IM node.exe` (kills Claude Code). Stop dev servers by PID.
- Theme: the concept-mockup palette (warm white, white cards, forest green, sand stage frame) from
  `apps/web/src/index.css` tokens only. No hard-coded hex in components.
- Windows dev box: PowerShell primary. Bare `node --test` has no dir arg; server tests use
  `tsx --test "src/**/*.test.ts"`.
