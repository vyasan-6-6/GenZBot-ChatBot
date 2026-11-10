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

export async function generateChatReply(
  messages: LlmMessage[],
  options?: {
    model?: string;
    temperature?: number;
  }
): Promise<LlmGenerationResult> {
  const model = options?.model ?? env.llmModel;
  const temperature = options?.temperature ?? env.llmTemperature;
  const startedAt = performance.now();

  let response: Response;
  try {
    response = await fetch(`${env.llmBaseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature,
        },
      }),
      signal: AbortSignal.timeout(env.llmTimeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new LlmServiceError(
        `LLM request timed out after ${env.llmTimeoutMs} ms`,
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

  const content = data.message?.content?.trim();
  if (!content) {
    throw new LlmServiceError("LLM API returned an empty response", 502);
  }

  const durationMs = Number((performance.now() - startedAt).toFixed(2));
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

