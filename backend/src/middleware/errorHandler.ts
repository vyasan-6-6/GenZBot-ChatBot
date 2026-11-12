import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { LlmServiceError } from "../services/llm.service.js";

export class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    ok: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      ok: false,
      error: err.message,
    });
    return;
  }

  if (err instanceof LlmServiceError) {
    res.status(err.statusCode).json({
      ok: false,
      error: err.message,
    });
    return;
  }

  if (err instanceof mongoose.Error.ValidationError) {
    res.status(400).json({
      ok: false,
      error: err.message,
    });
    return;
  }

  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({
      ok: false,
      error: "Invalid JSON payload in request body",
    });
    return;
  }

  console.error("[Express] Unhandled error:", err);

  const message =
    err instanceof Error ? err.message : "Internal server error";

  res.status(500).json({
    ok: false,
    error: message,
  });
}
