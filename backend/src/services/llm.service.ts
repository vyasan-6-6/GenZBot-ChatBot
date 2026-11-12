import { env } from "../config/env.js";

export type LlmRole = "system" | "user" | "assistant";

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmGenerationResult {
  content: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  durationMs: number;
  doneReason?: string;
}

interface OllamaChatResponse {
  model?: string;
  message?: {
    role?: string;
    content?: string;
  };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

export class LlmServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "LlmServiceError";
    this.statusCode = statusCode;
  }
}

async function callOllamaChat(payload: {
  model: string;
  messages: LlmMessage[];
  temperature: number;
  numPredict?: number;
  timeoutMs: number;
}): Promise<{ data: OllamaChatResponse; durationMs: number }> {
  const startedAt = performance.now();

  let response: Response;
  try {
    response = await fetch(`${env.llmBaseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: payload.model,
        messages: payload.messages,
        stream: false,
        options: {
          temperature: payload.temperature,
          ...(payload.numPredict !== undefined
            ? { num_predict: payload.numPredict }
            : {}),
        },
      }),
      signal: AbortSignal.timeout(payload.timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new LlmServiceError(
        `LLM request timed out after ${payload.timeoutMs} ms`,
        504
      );
    }

    throw new LlmServiceError(
      `Unable to reach Ollama at ${env.llmBaseUrl}. Make sure Ollama is running.`,
      502
    );
  }

  let data: OllamaChatResponse;
  try {
    data = (await response.json()) as OllamaChatResponse;
  } catch {
    throw new LlmServiceError(
      `LLM API returned a non-JSON response (HTTP ${response.status})`,
      502
    );
  }

  if (!response.ok || data.error) {
    throw new LlmServiceError(
      data.error ?? `LLM API error (HTTP ${response.status})`,
      502
    );
  }

  const durationMs = Number((performance.now() - startedAt).toFixed(2));
  return { data, durationMs };
}

export async function generateChatReply(
  messages: LlmMessage[],
  options?: {
    model?: string;
    temperature?: number;
  }
): Promise<LlmGenerationResult> {
  const model = options?.model ?? env.llmModel;
  const temperature = options?.temperature ?? env.llmTemperature;

  const { data, durationMs } = await callOllamaChat({
    model,
    messages,
    temperature,
    timeoutMs: env.llmTimeoutMs,
  });

  const content = data.message?.content?.trim();
  if (!content) {
    throw new LlmServiceError("LLM API returned an empty response", 502);
  }

  const promptTokens =
    typeof data.prompt_eval_count === "number"
      ? data.prompt_eval_count
      : undefined;
  const completionTokens =
    typeof data.eval_count === "number" ? data.eval_count : undefined;
  const totalTokens =
    promptTokens !== undefined && completionTokens !== undefined
      ? promptTokens + completionTokens
      : undefined;

  return {
    content,
    model: data.model ?? model,
    promptTokens,
    completionTokens,
    totalTokens,
    durationMs,
    doneReason: data.done_reason,
  };
}

export function sanitizeGeneratedTitle(raw: string): string {
  const firstLine =
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "";

  const cleaned = firstLine
    .replace(/^["'`#*:\-\s]+/, "")
    .replace(/^(?:title|topic|summary)\s*:\s*/i, "")
    .replace(/["'`#*]+$/g, "")
    .replace(/[.!?:;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length <= 80) return cleaned;
  return `${cleaned.slice(0, 77).trimEnd()}...`;
}

export async function generateConversationTitle(
  turns: Array<{ role: "user" | "assistant"; content: string }>,
  options?: { model?: string }
): Promise<string> {
  const transcript = turns
    .slice(0, 6)
    .map((turn) => {
      const label = turn.role === "user" ? "User" : "Assistant";
      const snippet = turn.content.replace(/\s+/g, " ").trim().slice(0, 300);
      return `${label}: ${snippet}`;
    })
    .join("\n");

  const { data } = await callOllamaChat({
    model: options?.model ?? env.llmModel,
    messages: [
      {
        role: "system",
        content:
          "Generate a concise 3 to 6 word title for this conversation. Return ONLY the plain title text, with no quotes, no markdown, and no trailing punctuation.",
      },
      {
        role: "user",
        content: transcript,
      },
    ],
    temperature: 0.2,
    numPredict: 24,
    timeoutMs: Math.min(env.llmTimeoutMs, 20_000),
  });

  const rawTitle = data.message?.content ?? "";
  const sanitized = sanitizeGeneratedTitle(rawTitle);

  if (!sanitized) {
    throw new LlmServiceError("LLM API returned an empty title", 502);
  }

  return sanitized;
}
