import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LandingPage } from "@/features/landing/LandingPage";
import { CaseWorkspace } from "@/features/workspace/CaseWorkspace";
import { SupportInboxPage } from "@/features/support/SupportInboxPage";
import { SupportTicketPage } from "@/features/support/SupportTicketPage";

function NotFound() {
  return (
    <main className="cyber-grid flex min-h-screen flex-col items-center justify-center gap-4 p-8 font-mono">
      <h1 className="text-2xl text-neon">Page not found</h1>
      <Link className="text-primary underline underline-offset-4" to="/">
        Back to products
      </Link>
    </main>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <TooltipProvider delayDuration={300}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/cases/:caseId" element={<Navigate to="issue" replace />} />
          <Route path="/cases/:caseId/:tab" element={<CaseWorkspace />} />
          <Route path="/support" element={<SupportInboxPage />} />
          <Route path="/support/tickets/:ticketId" element={<SupportTicketPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <Toaster theme="dark" position="bottom-right" />
      </TooltipProvider>
    </BrowserRouter>
  );
}
