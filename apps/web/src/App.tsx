import { lazy, Suspense } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDocumentTitle } from "@/lib/document-title";
import { LandingPage } from "@/features/landing/LandingPage";
import { CallDock } from "@/features/support/call/CallDock";
import { CallProvider } from "@/features/support/call/CallProvider";

// Heavy routes load on demand so the landing chunk stays small. The case workspace pulls in the
// Reactor X2 SDK; its wasm loader is emitted next to the chunks in dist/assets (vite.config.ts).
const CaseWorkspace = lazy(() =>
  import("@/features/workspace/CaseWorkspace").then((m) => ({ default: m.CaseWorkspace })),
);
const SupportInboxPage = lazy(() =>
  import("@/features/support/SupportInboxPage").then((m) => ({ default: m.SupportInboxPage })),
);
const SupportTicketPage = lazy(() =>
  import("@/features/support/SupportTicketPage").then((m) => ({ default: m.SupportTicketPage })),
);

function NotFound() {
  useDocumentTitle("Page not found");
  return (
    <main className="cyber-grid flex min-h-screen flex-col items-center justify-center gap-4 p-8 font-mono">
      <h1 className="text-2xl text-neon">Page not found</h1>
      <Link className="text-primary underline underline-offset-4" to="/">
        Back to products
      </Link>
    </main>
  );
}

function RouteLoading() {
  return (
    <main className="cyber-grid flex min-h-screen items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      <span role="status">Loading</span>
    </main>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <TooltipProvider delayDuration={300}>
        {/* The live support call sits above the pages so it survives route changes. */}
        <CallProvider>
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/cases/:caseId" element={<Navigate to="issue" replace />} />
              <Route path="/cases/:caseId/:tab" element={<CaseWorkspace />} />
              <Route path="/support" element={<SupportInboxPage />} />
              <Route path="/support/tickets/:ticketId" element={<SupportTicketPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          <CallDock />
        </CallProvider>
        <Toaster theme="dark" position="bottom-right" />
      </TooltipProvider>
    </BrowserRouter>
  );
}
