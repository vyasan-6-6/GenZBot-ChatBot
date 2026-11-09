import { Router } from "express";
import { pingDatabase } from "../config/db.js";
import { env } from "../config/env.js";

const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const database = await pingDatabase();
  const isHealthy = database.ok;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "ok" : "degraded",
    service: "genbot-backend",
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Number(process.uptime().toFixed(2)),
    database,
  });
});

export { healthRouter };

