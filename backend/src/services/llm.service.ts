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

function buildCombinedSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return externalSignal
    ? AbortSignal.any([timeoutSignal, externalSignal])
    : timeoutSignal;
}

function mapFetchError(
  error: unknown,
  timeoutMs: number,
  externalSignal?: AbortSignal
): Error {
  if (externalSignal?.aborted) {
    return error instanceof Error ? error : new DOMException("Aborted", "AbortError");
  }

  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new LlmServiceError(
      `LLM request timed out after ${timeoutMs} ms`,
      504
    );
  }

  return new LlmServiceError(
    `Unable to reach Ollama at ${env.llmBaseUrl}. Make sure Ollama is running.`,
    502
  );
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
    throw mapFetchError(error, payload.timeoutMs);
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

export async function generateChatReplyStream(
  messages: LlmMessage[],
  options: {
    model?: string;
    temperature?: number;
    signal?: AbortSignal;
    onToken: (token: string) => void;
  }
): Promise<LlmGenerationResult> {
  const model = options.model ?? env.llmModel;
  const temperature = options.temperature ?? env.llmTemperature;
  const startedAt = performance.now();
  const combinedSignal = buildCombinedSignal(env.llmTimeoutMs, options.signal);

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
        stream: true,
        options: {
          temperature,
        },
      }),
      signal: combinedSignal,
    });
  } catch (error) {
    throw mapFetchError(error, env.llmTimeoutMs, options.signal);
  }

  if (!response.ok) {
    let errorMessage = `LLM API error (HTTP ${response.status})`;
    try {
      const errorBody = (await response.json()) as { error?: string };
      if (errorBody.error) {
        errorMessage = errorBody.error;
      }
    } catch {
      // ignore non-JSON error body
    }
    throw new LlmServiceError(errorMessage, 502);
  }

  if (!response.body) {
    throw new LlmServiceError("LLM API returned an empty response stream", 502);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let lineBuffer = "";
  let fullContent = "";
  let resolvedModel = model;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let doneReason: string | undefined;

  const processLine = (rawLine: string) => {
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    let chunk: OllamaChatResponse;
    try {
      chunk = JSON.parse(trimmed) as OllamaChatResponse;
    } catch {
      throw new LlmServiceError("Received malformed JSON chunk from LLM stream", 502);
    }

    if (chunk.error) {
      throw new LlmServiceError(chunk.error, 502);
    }

    if (chunk.model) {
      resolvedModel = chunk.model;
    }

    const delta = chunk.message?.content;
    if (typeof delta === "string" && delta.length > 0) {
      fullContent += delta;
      options.onToken(delta);
    }

    if (chunk.done) {
      doneReason = chunk.done_reason;
      if (typeof chunk.prompt_eval_count === "number") {
        promptTokens = chunk.prompt_eval_count;
      }
      if (typeof chunk.eval_count === "number") {
        completionTokens = chunk.eval_count;
      }
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        processLine(line);
      }
    }

    lineBuffer += decoder.decode();
    if (lineBuffer.trim()) {
      processLine(lineBuffer);
    }
  } catch (error) {
    if (error instanceof LlmServiceError) {
      throw error;
    }
    throw mapFetchError(error, env.llmTimeoutMs, options.signal);
  } finally {
    reader.releaseLock();
  }

  const trimmedContent = fullContent.trim();
  if (!trimmedContent) {
    throw new LlmServiceError("LLM API returned an empty response", 502);
  }

  const durationMs = Number((performance.now() - startedAt).toFixed(2));
  const totalTokens =
    promptTokens !== undefined && completionTokens !== undefined
      ? promptTokens + completionTokens
      : undefined;

  return {
    content: trimmedContent,
    model: resolvedModel,
    promptTokens,
    completionTokens,
    totalTokens,
    durationMs,
    doneReason,
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


export interface AvailableModel {
  name: string;
  sizeBytes?: number;
  parameterSize?: string;
  quantization?: string;
  contextLength?: number;
  modifiedAt?: string;
}

interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
    size?: number;
    modified_at?: string;
    details?: {
      parameter_size?: string;
      quantization_level?: string;
      context_length?: number;
    };
  }>;
}

export async function listAvailableModels(): Promise<{
  ollamaReachable: boolean;
  models: AvailableModel[];
}> {
  try {
    const response = await fetch(`${env.llmBaseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return {
        ollamaReachable: false,
        models: [{ name: env.llmModel }],
      };
    }

    const data = (await response.json()) as OllamaTagsResponse;
    const models: AvailableModel[] = (data.models ?? [])
      .filter((item): item is NonNullable<typeof item> & { name: string } =>
        Boolean(item?.name)
      )
      .map((item) => ({
        name: item.name,
        sizeBytes: item.size,
        parameterSize: item.details?.parameter_size,
        quantization: item.details?.quantization_level,
        contextLength: item.details?.context_length,
        modifiedAt: item.modified_at,
      }));

    if (!models.some((m) => m.name === env.llmModel)) {
      models.unshift({ name: env.llmModel });
    }

    return {
      ollamaReachable: true,
      models,
    };
  } catch {
    return {
      ollamaReachable: false,
      models: [{ name: env.llmModel }],
    };
  }
}
