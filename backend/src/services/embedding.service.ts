import { env } from "../config/env.js";
import { HttpError } from "../middleware/errorHandler.js";

export interface BatchEmbeddingResult {
  vectors: number[][];
  model: string;
  dimensions: number;
  provider: string;
  durationMs: number;
}

export interface SingleEmbeddingResult {
  vector: number[];
  model: string;
  dimensions: number;
  provider: string;
  durationMs: number;
}

interface OllamaEmbedResponse {
  model?: string;
  embeddings?: number[][];
  error?: string;
}

interface OllamaLegacyEmbeddingResponse {
  embedding?: number[];
  error?: string;
}

interface OpenAiEmbeddingsResponse {
  model?: string;
  data?: Array<{
    index: number;
    embedding: number[];
  }>;
  error?: {
    message?: string;
  };
}

const DEFAULT_BATCH_SIZE = 16;

async function embedBatchWithOllama(
  texts: string[],
  model: string
): Promise<number[][]> {
  // Try Ollama's modern /api/embed batch endpoint first
  let response: Response;
  try {
    response = await fetch(`${env.embeddingBaseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: texts,
      }),
      signal: AbortSignal.timeout(env.embeddingTimeoutMs),
    });
  } catch (error) {
    throw new HttpError(
      502,
      `Unable to reach Ollama embedding service at ${env.embeddingBaseUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // Fallback for older Ollama versions that only expose /api/embeddings
  if (response.status === 404) {
    const vectors: number[][] = [];
    for (const text of texts) {
      const legacyRes = await fetch(`${env.embeddingBaseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: text }),
        signal: AbortSignal.timeout(env.embeddingTimeoutMs),
      });
      const legacyData =
        (await legacyRes.json()) as OllamaLegacyEmbeddingResponse;
      if (!legacyRes.ok || !Array.isArray(legacyData.embedding)) {
        throw new HttpError(
          502,
          legacyData.error ??
            `Ollama legacy embedding error (HTTP ${legacyRes.status})`
        );
      }
      vectors.push(legacyData.embedding);
    }
    return vectors;
  }

  const data = (await response.json().catch(() => ({}))) as OllamaEmbedResponse;

  if (!response.ok || data.error) {
    const hint =
      response.status === 404 || data.error?.includes("not found")
        ? ` Make sure the embedding model is pulled (e.g. "ollama pull ${model}").`
        : "";
    throw new HttpError(
      502,
      `${data.error ?? `Ollama embedding failed (HTTP ${response.status})`}${hint}`
    );
  }

  if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) {
    throw new HttpError(
      502,
      `Ollama returned ${data.embeddings?.length ?? 0} embeddings for ${texts.length} inputs.`
    );
  }

  return data.embeddings;
}

async function embedBatchWithOpenAiCompatible(
  texts: string[],
  model: string
): Promise<number[][]> {
  const endpoint = env.embeddingBaseUrl.endsWith("/v1")
    ? `${env.embeddingBaseUrl}/embeddings`
    : `${env.embeddingBaseUrl}/v1/embeddings`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (env.embeddingApiKey) {
    headers.Authorization = `Bearer ${env.embeddingApiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        input: texts,
      }),
      signal: AbortSignal.timeout(env.embeddingTimeoutMs),
    });
  } catch (error) {
    throw new HttpError(
      502,
      `Unable to reach OpenAI-compatible embedding API at ${endpoint}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const data =
    (await response.json().catch(() => ({}))) as OpenAiEmbeddingsResponse;

  if (!response.ok || data.error) {
    throw new HttpError(
      502,
      data.error?.message ??
        `OpenAI-compatible embedding failed (HTTP ${response.status})`
    );
  }

  if (!Array.isArray(data.data) || data.data.length !== texts.length) {
    throw new HttpError(
      502,
      `Embedding API returned ${data.data?.length ?? 0} vectors for ${texts.length} inputs.`
    );
  }

  return data.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

/**
 * Generates vector embeddings for a batch of text strings.
 * Supports local Ollama and OpenAI-compatible open-source cloud APIs.
 */
export async function generateEmbeddings(
  texts: string[],
  options?: { model?: string; batchSize?: number }
): Promise<BatchEmbeddingResult> {
  if (texts.length === 0) {
    return {
      vectors: [],
      model: options?.model ?? env.embeddingModel,
      dimensions: 0,
      provider: env.embeddingProvider,
      durationMs: 0,
    };
  }

  const startedAt = performance.now();
  const model = options?.model ?? env.embeddingModel;
  const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
  const provider = env.embeddingProvider;

  const allVectors: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchVectors =
      provider === "openai-compatible"
        ? await embedBatchWithOpenAiCompatible(batch, model)
        : await embedBatchWithOllama(batch, model);

    allVectors.push(...batchVectors);
  }

  const dimensions = allVectors[0]?.length ?? 0;
  const durationMs = Number((performance.now() - startedAt).toFixed(2));

  return {
    vectors: allVectors,
    model,
    dimensions,
    provider,
    durationMs,
  };
}

/**
 * Generates a single embedding vector for a query or text snippet.
 */
export async function generateEmbedding(
  text: string,
  options?: { model?: string }
): Promise<SingleEmbeddingResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new HttpError(400, "Cannot generate embedding for empty text.");
  }

  const result = await generateEmbeddings([trimmed], options);
  const vector = result.vectors[0];
  if (!vector || vector.length === 0) {
    throw new HttpError(502, "Embedding service returned an empty vector.");
  }

  return {
    vector,
    model: result.model,
    dimensions: result.dimensions,
    provider: result.provider,
    durationMs: result.durationMs,
  };
}

/**
 * Computes cosine similarity between two equal-length vectors (-1 to 1).
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}
