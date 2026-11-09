import mongoose from "mongoose";
import { env } from "./env.js";

export interface DatabasePingResult {
  ok: boolean;
  status: string;
  readyState: number;
  pingMs: number | null;
  databaseName: string | null;
  host: string | null;
  error?: string;
}

const READY_STATE_LABELS: Record<number, string> = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

export function getConnectionStateLabel(readyState: number): string {
  return READY_STATE_LABELS[readyState] ?? "unknown";
}

let listenersRegistered = false;

function registerConnectionListeners(): void {
  if (listenersRegistered) return;
  listenersRegistered = true;

  mongoose.connection.on("connected", () => {
    console.log(
      `[MongoDB] Connected to "${mongoose.connection.name}" at ${mongoose.connection.host}:${mongoose.connection.port}`
    );
  });

  mongoose.connection.on("error", (error) => {
    console.error("[MongoDB] Connection error:", error);
  });

  mongoose.connection.on("disconnected", () => {
    console.warn("[MongoDB] Disconnected from database");
  });
}

export async function connectToDatabase(): Promise<typeof mongoose> {
  registerConnectionListeners();

  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  return mongoose.connect(env.mongodbUri, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
  });
}

export async function disconnectFromDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

export async function pingDatabase(): Promise<DatabasePingResult> {
  const readyState = mongoose.connection.readyState;
  const status = getConnectionStateLabel(readyState);
  const db = mongoose.connection.db;

  if (readyState !== 1 || !db) {
    return {
      ok: false,
      status,
      readyState,
      pingMs: null,
      databaseName: null,
      host: null,
      error: "Database connection is not active",
    };
  }

  const startedAt = performance.now();
  try {
    await db.admin().ping();
    const pingMs = Number((performance.now() - startedAt).toFixed(2));

    return {
      ok: true,
      status,
      readyState,
      pingMs,
      databaseName: db.databaseName,
      host: `${mongoose.connection.host}:${mongoose.connection.port}`,
    };
  } catch (error) {
    const pingMs = Number((performance.now() - startedAt).toFixed(2));
    return {
      ok: false,
      status: "error",
      readyState: mongoose.connection.readyState,
      pingMs,
      databaseName: db.databaseName,
      host: `${mongoose.connection.host}:${mongoose.connection.port}`,
      error: error instanceof Error ? error.message : "Unknown ping failure",
    };
  }
}

