import { Router } from "express";
import { env } from "../config/env.js";
import { ChatMessage } from "../models/ChatMessage.js";
import { Conversation } from "../models/Conversation.js";
import {
  ensureDatabaseReady,
  sendMessageToConversation,
} from "../services/chat.service.js";

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
  ensureDatabaseReady();

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
  ensureDatabaseReady();

  const targetConversationId =
    typeof req.body?.conversationId === "string" && req.body.conversationId.trim()
      ? req.body.conversationId.trim()
      : String((await getOrCreateDefaultConversation())._id);

  const result = await sendMessageToConversation({
    conversationId: targetConversationId,
    message: req.body?.message,
    temperature: req.body?.temperature,
  });

  res.status(201).json({
    ok: true,
    conversationId: result.conversation._id,
    conversation: result.conversation,
    userMessage: result.userMessage,
    assistantMessage: result.assistantMessage,
    meta: result.meta,
  });
});

chatRouter.delete("/history", async (_req, res) => {
  ensureDatabaseReady();

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

  await Conversation.updateOne(
    { _id: conversation._id },
    { $set: { messageCount: 0 }, $unset: { lastMessagePreview: 1 } }
  );

  res.status(200).json({
    ok: true,
    deletedCount: result.deletedCount ?? 0,
  });
});

export { chatRouter };
