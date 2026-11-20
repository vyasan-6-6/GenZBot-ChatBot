import { Pinecone, type RecordMetadata } from "@pinecone-database/pinecone";
import { env } from "../config/env.js";
import { DocumentChunkModel } from "../models/DocumentChunk.js";
import { cosineSimilarity } from "./embedding.service.js";

export interface VectorChunkMetadata extends RecordMetadata {
  documentId: string;
  conversationId: string;
  fileName: string;
  chunkIndex: number;
  text: string;
  characterCount: number;
}

export interface VectorRecord {
  id: string;
  values: number[];
  metadata: VectorChunkMetadata;
}

export interface VectorQueryResult {
  id: string;
  score: number;
  metadata: VectorChunkMetadata;
}

export interface VectorStoreStatus {
  provider: "pinecone" | "local";
  isPineconeConfigured: boolean;
  indexName?: string;
  namespace?: string;
  details?: string;
}

let pineconeClient: Pinecone | null = null;

function getPineconeClient(): Pinecone | null {
  if (!env.pineconeApiKey) {
    return null;
  }
  if (!pineconeClient) {
    pineconeClient = new Pinecone({ apiKey: env.pineconeApiKey });
  }
  return pineconeClient;
}

export function isPineconeAvailable(): boolean {
  return Boolean(env.pineconeApiKey && env.pineconeIndex);
}

export function getVectorStoreStatus(): VectorStoreStatus {
  if (isPineconeAvailable()) {
    return {
      provider: "pinecone",
      isPineconeConfigured: true,
      indexName: env.pineconeIndex,
      namespace: env.pineconeNamespace || "default",
      details: "Connected to Pinecone cloud vector database",
    };
  }

  return {
    provider: "local",
    isPineconeConfigured: false,
    details:
      "Using local MongoDB vector store with cosine similarity math (set PINECONE_API_KEY and PINECONE_INDEX in .env to use Pinecone)",
  };
}

/**
 * Upserts a list of vector records into Pinecone, or verifies local MongoDB persistence.
 */
export async function upsertVectors(
  records: VectorRecord[]
): Promise<{ provider: "pinecone" | "local"; count: number }> {
  if (records.length === 0) {
    return {
      provider: isPineconeAvailable() ? "pinecone" : "local",
      count: 0,
    };
  }

  const pinecone = getPineconeClient();

  if (pinecone && env.pineconeIndex) {
    try {
      const index = pinecone.index<VectorChunkMetadata>(env.pineconeIndex);
      const target = env.pineconeNamespace
        ? index.namespace(env.pineconeNamespace)
        : index;

      // Upsert in batches of 50 to respect Pinecone payload limits
      const BATCH_SIZE = 50;
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE).map((r) => ({
          id: r.id,
          values: r.values,
          metadata: r.metadata,
        }));
        await target.upsert({ records: batch });
      }

      return { provider: "pinecone", count: records.length };
    } catch (pineconeError) {
      console.warn(
        "[VectorStore] Pinecone upsert failed, falling back to local store:",
        pineconeError instanceof Error ? pineconeError.message : pineconeError
      );
      // Fall through to local fallback below
    }
  }

  // Local MongoDB store fallback
  // The embeddings are already stored in MongoDB on DocumentChunkModel in Feature 2
  return { provider: "local", count: records.length };
}

/**
 * Queries the vector store for the top-K most similar chunks to a query vector.
 * Automatically uses Pinecone if configured, or falls back to local cosine similarity.
 */
export async function queryVectors(params: {
  vector: number[];
  topK?: number;
  filter?: {
    conversationId?: string;
    documentId?: string;
  };
}): Promise<{ provider: "pinecone" | "local"; matches: VectorQueryResult[] }> {
  const topK = Math.max(1, params.topK ?? 4);
  const pinecone = getPineconeClient();

  if (pinecone && env.pineconeIndex) {
    try {
      const index = pinecone.index<VectorChunkMetadata>(env.pineconeIndex);
      const target = env.pineconeNamespace
        ? index.namespace(env.pineconeNamespace)
        : index;

      const pineconeFilter: Record<string, unknown> = {};
      if (params.filter?.conversationId) {
        pineconeFilter.conversationId = { $eq: params.filter.conversationId };
      }
      if (params.filter?.documentId) {
        pineconeFilter.documentId = { $eq: params.filter.documentId };
      }

      const response = await target.query({
        vector: params.vector,
        topK,
        includeMetadata: true,
        filter: Object.keys(pineconeFilter).length > 0 ? pineconeFilter : undefined,
      });

      const matches: VectorQueryResult[] = (response.matches ?? [])
        .filter((m) => m.metadata !== undefined)
        .map((m) => ({
          id: m.id,
          score: Number((m.score ?? 0).toFixed(4)),
          metadata: m.metadata as VectorChunkMetadata,
        }));

      return { provider: "pinecone", matches };
    } catch (pineconeError) {
      console.warn(
        "[VectorStore] Pinecone query failed, falling back to local cosine search:",
        pineconeError instanceof Error ? pineconeError.message : pineconeError
      );
      // Fall through to local fallback
    }
  }

  // Local MongoDB cosine similarity search
  const mongoFilter: Record<string, unknown> = {
    embedding: { $exists: true, $ne: [] },
  };
  if (params.filter?.conversationId) {
    mongoFilter.conversationId = params.filter.conversationId;
  }
  if (params.filter?.documentId) {
    mongoFilter.documentId = params.filter.documentId;
  }

  const chunks = await DocumentChunkModel.find(mongoFilter)
    .select("+embedding")
    .lean();

  if (chunks.length === 0) {
    return { provider: "local", matches: [] };
  }

  const scoredMatches: VectorQueryResult[] = [];

  for (const chunk of chunks) {
    if (!Array.isArray(chunk.embedding) || chunk.embedding.length === 0) {
      continue;
    }

    const similarity = cosineSimilarity(params.vector, chunk.embedding);

    scoredMatches.push({
      id: String(chunk._id),
      score: Number(similarity.toFixed(4)),
      metadata: {
        documentId: String(chunk.documentId),
        conversationId: String(chunk.conversationId),
        fileName: chunk.metadata?.fileName ?? "Document",
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        characterCount: chunk.characterCount,
      },
    });
  }

  scoredMatches.sort((a, b) => b.score - a.score);
  const topMatches = scoredMatches.slice(0, topK);

  return { provider: "local", matches: topMatches };
}

/**
 * Deletes vectors by documentId or conversationId from Pinecone and/or local store.
 */
export async function deleteVectors(params: {
  documentId?: string;
  conversationId?: string;
}): Promise<{ provider: "pinecone" | "local"; deleted: boolean }> {
  const pinecone = getPineconeClient();

  if (pinecone && env.pineconeIndex) {
    try {
      const index = pinecone.index<VectorChunkMetadata>(env.pineconeIndex);
      const target = env.pineconeNamespace
        ? index.namespace(env.pineconeNamespace)
        : index;

      const deleteFilter: Record<string, unknown> = {};
      if (params.documentId) {
        deleteFilter.documentId = { $eq: params.documentId };
      }
      if (params.conversationId) {
        deleteFilter.conversationId = { $eq: params.conversationId };
      }

      if (Object.keys(deleteFilter).length > 0) {
        await target.deleteMany(deleteFilter);
      }

      return { provider: "pinecone", deleted: true };
    } catch (pineconeError) {
      console.warn(
        "[VectorStore] Pinecone vector deletion failed:",
        pineconeError instanceof Error ? pineconeError.message : pineconeError
      );
    }
  }

  // In local store, DocumentChunkModel.deleteMany is handled by document.service.ts
  return { provider: "local", deleted: true };
}
