import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { echoRouter } from "./routes/echo.routes.js";
import { healthRouter } from "./routes/health.routes.js";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.clientUrl,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type"],
    })
  );

  app.use(express.json({ limit: "16kb" }));

  app.use((req, res, next) => {
    const startedAt = performance.now();
    res.on("finish", () => {
      const durationMs = (performance.now() - startedAt).toFixed(2);
      console.log(
        `[Express] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs} ms)`
      );
    });
    next();
  });

  app.get("/", (_req, res) => {
    res.status(200).json({
      service: "genbot-backend",
      status: "running",
      endpoints: {
        health: "/api/health",
        echo: "/api/echo",
      },
    });
  });

  app.use("/api/health", healthRouter);
  app.use("/api/echo", echoRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

