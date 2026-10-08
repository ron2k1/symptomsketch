import { existsSync } from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { LIMITS } from "@symptomsketch/contracts";
import type { AppContext, RegisterRoutes } from "./context.ts";
import { apiNotFound, errorMiddleware } from "./http/errors.ts";
import { originCheck } from "./http/origin.ts";
import { sessionMiddleware } from "./http/session.ts";
import { register as health } from "./routes/health.ts";
import { register as session } from "./routes/session.ts";
import { register as catalog } from "./routes/catalog.ts";
import { register as cases } from "./routes/cases.ts";
import { register as assets } from "./routes/assets.ts";
import { register as plans } from "./routes/plans.ts";
import { register as procedures } from "./routes/procedures.ts";
import { register as reactor } from "./routes/reactor.ts";
import { register as assessments } from "./routes/assessments.ts";
import { register as takes } from "./routes/takes.ts";
import { register as productBox } from "./routes/product-box.ts";
import { register as support } from "./support/routes.ts";

/** Route modules in mount order. Each registers full `/api/...` paths from contracts ROUTES. */
const MODULES: readonly RegisterRoutes[] = [
  health,
  session,
  catalog,
  cases,
  assets,
  plans,
  procedures,
  reactor,
  productBox,
  assessments,
  takes,
  support,
];

export interface CreateAppOptions {
  /** Serve apps/web/dist with SPA fallback. Default: when dist/index.html exists. */
  serveWeb?: boolean;
}

export function createApp(ctx: AppContext, opts: CreateAppOptions = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  if (ctx.config.isProduction) app.set("trust proxy", 1);

  app.use("/api", express.json({ limit: LIMITS.jsonBodyMaxBytes }));
  app.use("/api", cookieParser());
  app.use("/api", originCheck(ctx.config));
  app.use("/api", sessionMiddleware(ctx));
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  const api = express.Router();
  for (const register of MODULES) register(api, ctx);
  app.use(api);
  app.use(apiNotFound);

  const distIndex = path.join(ctx.config.webDistDir, "index.html");
  const serveWeb = opts.serveWeb ?? existsSync(distIndex);
  if (serveWeb) {
    app.use(
      "/assets",
      express.static(path.join(ctx.config.webDistDir, "assets"), {
        index: false,
        fallthrough: true,
        maxAge: "1h",
      }),
    );
    app.use(express.static(ctx.config.webDistDir, { index: false, maxAge: 0 }));
    // SPA fallback: any non-API GET that wants HTML gets index.html (client routes deep-link).
    app.use((req, res, next) => {
      if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api")) {
        return next();
      }
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(distIndex, (err) => {
        if (err) next(err);
      });
    });
  }

  app.use(errorMiddleware);
  return app;
}
