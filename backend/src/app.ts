import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { chatRouter } from "./routes/chat.routes.js";
import { conversationsRouter } from "./routes/conversations.routes.js";
import { echoRouter } from "./routes/echo.routes.js";
import { healthRouter } from "./routes/health.routes.js";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.clientUrl,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type"],
    })
  );

  app.use(express.json({ limit: "64kb" }));

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
        conversations: "/api/conversations",
        chat: "/api/chat",
        chatHistory: "/api/chat/history",
        echo: "/api/echo",
      },
    });
  });

  app.use("/api/health", healthRouter);
  app.use("/api/conversations", conversationsRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/echo", echoRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
