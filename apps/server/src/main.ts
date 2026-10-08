import type { Server } from "node:http";
import { createApp } from "./app.ts";
import { configStatus, getConfig } from "./config.ts";
import { createContext } from "./context.ts";

const config = getConfig();
const ctx = createContext(config);
const recovered = ctx.jobs.recoverJobs();
ctx.jobs.start();

const app = createApp(ctx);
const server: Server = app.listen(config.port, "0.0.0.0", () => {
  const status = configStatus(config);
  console.log(
    `[server] listening on 0.0.0.0:${config.port} (${config.nodeEnv}); ` +
      `recovered jobs: ${recovered}; config missing: ${status.missing.join(", ") || "none"}`,
  );
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal}: shutting down`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  server.close();
  server.closeAllConnections?.();
  await ctx.jobs.stop();
  try {
    ctx.db.close();
  } catch {
    // already closed
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
