import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../../.env");

dotenv.config({ path: envPath });

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  name: string,
  max?: number
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1 || (max !== undefined && parsed > max)) {
    throw new Error(`Invalid ${name} environment variable: "${value}"`);
  }
  return parsed;
}

function parseTemperature(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 2) {
    throw new Error(
      `Invalid LLM_TEMPERATURE environment variable (must be 0..2): "${value}"`
    );
  }
  return parsed;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parsePositiveInt(process.env.PORT, 4000, "PORT", 65535),
  mongodbUri:
    process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/genbot_foundation",
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:3000",
  llmBaseUrl: (process.env.LLM_BASE_URL ?? "http://127.0.0.1:11434").replace(
    /\/+$/,
    ""
  ),
  llmModel: process.env.LLM_MODEL ?? "qwen2.5:3b",
  llmTemperature: parseTemperature(process.env.LLM_TEMPERATURE, 0.7),
  llmSystemPrompt:
    process.env.LLM_SYSTEM_PROMPT ??
    "You are GenZBot, a helpful, concise, and friendly AI assistant.",
  llmMaxHistoryMessages: parsePositiveInt(
    process.env.LLM_MAX_HISTORY_MESSAGES,
    20,
    "LLM_MAX_HISTORY_MESSAGES",
    100
  ),
  llmTimeoutMs: parsePositiveInt(
    process.env.LLM_TIMEOUT_MS,
    120_000,
    "LLM_TIMEOUT_MS"
  ),
} as const;
