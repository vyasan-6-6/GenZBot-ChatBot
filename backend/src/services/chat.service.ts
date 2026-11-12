import mongoose from "mongoose";
import { env } from "../config/env.js";
import { HttpError } from "../middleware/errorHandler.js";
import { ChatMessage } from "../models/ChatMessage.js";
import { Conversation } from "../models/Conversation.js";
import { generateChatReply, type LlmMessage } from "./llm.service.js";

const DEFAULT_TITLES = new Set(["New Chat", "GenZBot Chat"]);

export function ensureDatabaseReady(): void {
  if (mongoose.connection.readyState !== 1) {
    throw new HttpError(503, "Database connection is not active");
  }
}

export function validateMessageInput(rawMessage: unknown): string {
  const trimmed = typeof rawMessage === "string" ? rawMessage.trim() : "";

  if (!trimmed) {
    throw new HttpError(400, "Please provide a non-empty 'message' string.");
  }

  if (trimmed.length > 4000) {
    throw new HttpError(400, "Message cannot exceed 4000 characters.");
  }

  return trimmed;
}

export function validateTemperature(rawTemp: unknown): number {
  if (rawTemp === undefined) {
    return env.llmTemperature;
  }

  const parsed = Number(rawTemp);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 2) {
    throw new HttpError(400, "Temperature must be a number between 0 and 2.");
  }

  return parsed;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function buildAutoTitle(text: string): string {
  const clean = collapseWhitespace(text);
  if (clean.length <= 48) return clean;
  return `${clean.slice(0, 45).trimEnd()}...`;
}

export function buildPreview(text: string): string {
  const clean = collapseWhitespace(text);
  if (clean.length <= 100) return clean;
  return `${clean.slice(0, 97).trimEnd()}...`;
}

export async function sendMessageToConversation(params: {
  conversationId: string;
  message: unknown;
  temperature?: unknown;
}) {
  ensureDatabaseReady();

  if (!mongoose.isValidObjectId(params.conversationId)) {
    throw new HttpError(400, "Invalid conversation ID");
  }

  const userText = validateMessageInput(params.message);
  const temperature = validateTemperature(params.temperature);

  const conversation = await Conversation.findById(params.conversationId).lean();
  if (!conversation) {
    throw new HttpError(404, "Conversation not found");
  }

  const recentHistory = await ChatMessage.find({
    conversationId: conversation._id,
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(env.llmMaxHistoryMessages)
    .lean();

  recentHistory.reverse();

  const systemPrompt = conversation.systemPrompt ?? env.llmSystemPrompt;

  const llmMessages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    ...recentHistory.map((item) => ({
      role: item.role as "user" | "assistant",
      content: item.content,
    })),
    { role: "user", content: userText },
  ];

  const reply = await generateChatReply(llmMessages, { temperature });

  const userCreatedAt = new Date();
  const userMessage = await ChatMessage.create({
    conversationId: conversation._id,
    role: "user",
    content: userText,
    createdAt: userCreatedAt,
    updatedAt: userCreatedAt,
  });

  const assistantCreatedAt = new Date(
    Math.max(Date.now(), userCreatedAt.getTime() + 1)
  );

  const usage =
    reply.promptTokens !== undefined || reply.completionTokens !== undefined
      ? {
          promptTokens: reply.promptTokens,
          completionTokens: reply.completionTokens,
          totalTokens: reply.totalTokens,
        }
      : undefined;

  const assistantMessage = await ChatMessage.create({
    conversationId: conversation._id,
    role: "assistant",
    content: reply.content,
    model: reply.model,
    usage,
    durationMs: reply.durationMs,
    createdAt: assistantCreatedAt,
    updatedAt: assistantCreatedAt,
  });

  const shouldAutoTitle = DEFAULT_TITLES.has(conversation.title);

  const updatedConversation = await Conversation.findByIdAndUpdate(
    conversation._id,
    {
      $inc: { messageCount: 2 },
      $set: {
        updatedAt: assistantCreatedAt,
        lastMessagePreview: buildPreview(reply.content),
        ...(shouldAutoTitle ? { title: buildAutoTitle(userText) } : {}),
      },
    },
    { returnDocument: "after" }
  ).lean();

  return {
    conversation: updatedConversation ?? conversation,
    userMessage: userMessage.toObject(),
    assistantMessage: assistantMessage.toObject(),
    meta: {
      model: reply.model,
      temperature,
      contextMessagesSent: llmMessages.length,
    },
  };
}

