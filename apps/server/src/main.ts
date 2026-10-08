import express from "express";
import { CONTRACTS_VERSION } from "@symptomsketch/contracts";

const app = express();
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, contracts: CONTRACTS_VERSION });
});
app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
