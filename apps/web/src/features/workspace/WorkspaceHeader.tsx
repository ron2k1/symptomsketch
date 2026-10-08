import { useRef, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import {
  APP_PATHS,
  CASE_TABS,
  CASE_TAB_LABELS,
  SOURCE_TYPE_LABELS,
  type CaseTab,
} from "@symptomsketch/contracts";
import { cn } from "@/lib/utils";
import { useWorkspace } from "./WorkspaceProvider";

export function tabId(tab: CaseTab): string {
  return `case-tab-${tab}`;
}

export function panelId(tab: CaseTab): string {
  return `case-panel-${tab}`;
}

const BUSY_HINT = "Finish or cancel the recording first";

export function WorkspaceHeader() {
  const { tab, goTab, captureBusy, state, productName, modelLabel } = useWorkspace();
  const refs = useRef<Partial<Record<CaseTab, HTMLButtonElement | null>>>({});
  const caseData = state.caseData;
  const product = caseData?.product ?? null;
  const isSupportCase = caseData?.ownerRole === "support";
  const backHref =
    isSupportCase && caseData?.sourceTicketId
      ? APP_PATHS.supportTicket(caseData.sourceTicketId)
      : isSupportCase
        ? APP_PATHS.supportInbox()
        : APP_PATHS.landing();
  const backLabel = isSupportCase ? "Back to ticket" : "Back to products";

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    const i = CASE_TABS.indexOf(tab);
    let next: CaseTab | undefined;
    if (e.key === "ArrowRight") next = CASE_TABS[(i + 1) % CASE_TABS.length];
    else if (e.key === "ArrowLeft") next = CASE_TABS[(i - 1 + CASE_TABS.length) % CASE_TABS.length];
    else if (e.key === "Home") next = CASE_TABS[0];
    else if (e.key === "End") next = CASE_TABS[CASE_TABS.length - 1];
    if (!next || captureBusy) return;
    e.preventDefault();
    goTab(next);
    refs.current[next]?.focus();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-[1600px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 md:px-6">
        <Link
          to={APP_PATHS.landing()}
          className="font-mono text-lg font-semibold tracking-tight text-foreground"
          aria-label="SymptomSketch home"
          onClick={(e) => captureBusy && e.preventDefault()}
        >
          Symptom<span className="text-neon">Sketch</span>
        </Link>

        {caseData ? (
          <div
            className="flex min-w-0 items-center gap-2 rounded-full border border-border bg-surface px-1.5 py-1 pr-3"
            title="Selected product"
          >
            {product ? (
              <img
                src={product.normalized.mediaUrl}
                alt=""
                className="size-7 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="size-7 shrink-0 rounded-full bg-muted" aria-hidden />
            )}
            <span className="min-w-0 truncate text-sm">
              {productName}
              {modelLabel ? <span className="text-muted-foreground"> / {modelLabel}</span> : null}
            </span>
            {product ? (
              <span className="hidden font-mono text-[11px] text-neon sm:inline">
                {SOURCE_TYPE_LABELS[product.sourceType]}
              </span>
            ) : null}
          </div>
        ) : null}

        <nav className="order-last w-full sm:order-none sm:ml-auto sm:w-auto" aria-label="Case">
          <div
            role="tablist"
            aria-label="Case sections"
            className="flex rounded-lg border border-border bg-surface p-1"
          >
            {CASE_TABS.map((t) => {
              const selected = t === tab;
              return (
                <button
                  key={t}
                  ref={(el) => {
                    refs.current[t] = el;
                  }}
                  type="button"
                  role="tab"
                  id={tabId(t)}
                  aria-selected={selected}
                  aria-controls={panelId(t)}
                  tabIndex={selected ? 0 : -1}
                  disabled={captureBusy && !selected}
                  title={captureBusy && !selected ? BUSY_HINT : undefined}
                  onClick={() => !selected && goTab(t)}
                  onKeyDown={onTabKey}
                  className={cn(
                    "min-h-11 flex-1 rounded-md px-4 font-mono text-sm transition-colors sm:flex-none",
                    selected
                      ? "bg-neon-soft text-neon shadow-[var(--glow)]"
                      : "text-muted-foreground hover:text-foreground",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  {CASE_TAB_LABELS[t]}
                </button>
              );
            })}
          </div>
        </nav>

        <Link
          to={backHref}
          aria-disabled={captureBusy}
          title={captureBusy ? BUSY_HINT : undefined}
          onClick={(e) => captureBusy && e.preventDefault()}
          className={cn(
            "inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground",
            captureBusy && "pointer-events-none opacity-50",
          )}
        >
          <ArrowLeft className="size-4" aria-hidden />
          {backLabel}
        </Link>
      </div>
    </header>
  );
}
