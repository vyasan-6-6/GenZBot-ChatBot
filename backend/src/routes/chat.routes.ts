import { Router } from "express";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { ChatMessage } from "../models/ChatMessage.js";
import { Conversation } from "../models/Conversation.js";
import { generateChatReply, type LlmMessage } from "../services/llm.service.js";

const chatRouter = Router();
const DEFAULT_SESSION_KEY = "default";

async function getOrCreateDefaultConversation() {
  return Conversation.findOneAndUpdate(
    { sessionKey: DEFAULT_SESSION_KEY },
    {
      $setOnInsert: {
        sessionKey: DEFAULT_SESSION_KEY,
        title: "GenZBot Chat",
        systemPrompt: env.llmSystemPrompt,
      },
    },
    {
      upsert: true,
      returnDocument: "after",
    }
  ).lean();
}

chatRouter.get("/history", async (_req, res) => {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({
      ok: false,
      error: "Database connection is not active",
    });
    return;
  }

  const conversation = await getOrCreateDefaultConversation();
  const messages = await ChatMessage.find({ conversationId: conversation._id })
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  res.status(200).json({
    ok: true,
    conversationId: conversation._id,
    model: env.llmModel,
    temperature: env.llmTemperature,
    systemPrompt: conversation.systemPrompt ?? env.llmSystemPrompt,
    messages,
  });
});

chatRouter.post("/", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({
      ok: false,
      error: "Database connection is not active",
    });
    return;
  }

  const userText =
    typeof req.body?.message === "string" ? req.body.message.trim() : "";

  if (!userText) {
    res.status(400).json({
      ok: false,
      error: "Please provide a non-empty 'message' string.",
    });
    return;
  }

  if (userText.length > 4000) {
    res.status(400).json({
      ok: false,
      error: "Message cannot exceed 4000 characters.",
    });
    return;
  }

  let temperature = env.llmTemperature;
  if (req.body?.temperature !== undefined) {
    const parsedTemp = Number(req.body.temperature);
    if (Number.isNaN(parsedTemp) || parsedTemp < 0 || parsedTemp > 2) {
      res.status(400).json({
        ok: false,
        error: "Temperature must be a number between 0 and 2.",
      });
      return;
    }
    temperature = parsedTemp;
  }

  const conversation = await getOrCreateDefaultConversation();

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

  await Conversation.updateOne(
    { _id: conversation._id },
    { $set: { updatedAt: assistantCreatedAt } }
  );

  res.status(201).json({
    ok: true,
    conversationId: conversation._id,
    userMessage: userMessage.toObject(),
    assistantMessage: assistantMessage.toObject(),
    meta: {
      model: reply.model,
      temperature,
      contextMessagesSent: llmMessages.length,
    },
  });
});

chatRouter.delete("/history", async (_req, res) => {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({
      ok: false,
      error: "Database connection is not active",
    });
    return;
  }

  const conversation = await Conversation.findOne({
    sessionKey: DEFAULT_SESSION_KEY,
  }).lean();

  if (!conversation) {
    res.status(200).json({ ok: true, deletedCount: 0 });
    return;
  }

  const result = await ChatMessage.deleteMany({
    conversationId: conversation._id,
  });

  res.status(200).json({
    ok: true,
    deletedCount: result.deletedCount ?? 0,
  });
});

export { chatRouter };

