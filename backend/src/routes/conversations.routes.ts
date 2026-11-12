import { Router } from "express";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { HttpError } from "../middleware/errorHandler.js";
import { ChatMessage } from "../models/ChatMessage.js";
import { Conversation } from "../models/Conversation.js";
import {
  ensureDatabaseReady,
  sendMessageToConversation,
} from "../services/chat.service.js";

const conversationsRouter = Router();

function assertValidObjectId(id: string): void {
  if (!mongoose.isValidObjectId(id)) {
    throw new HttpError(400, "Invalid conversation ID");
  }
}

conversationsRouter.get("/", async (_req, res) => {
  ensureDatabaseReady();

  const conversations = await Conversation.find()
    .sort({ updatedAt: -1, _id: -1 })
    .lean();

  res.status(200).json({
    ok: true,
    count: conversations.length,
    conversations,
  });
});

conversationsRouter.post("/", async (req, res) => {
  ensureDatabaseReady();

  const rawTitle =
    typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const title = rawTitle || "New Chat";

  if (title.length > 120) {
    throw new HttpError(400, "Conversation title cannot exceed 120 characters.");
  }

  const rawSystemPrompt =
    typeof req.body?.systemPrompt === "string"
      ? req.body.systemPrompt.trim()
      : "";

  const conversation = await Conversation.create({
    title,
    systemPrompt: rawSystemPrompt || env.llmSystemPrompt,
    messageCount: 0,
  });

  res.status(201).json({
    ok: true,
    conversation: conversation.toObject(),
  });
});

conversationsRouter.get("/:id", async (req, res) => {
  ensureDatabaseReady();
  assertValidObjectId(req.params.id);

  const conversation = await Conversation.findById(req.params.id).lean();
  if (!conversation) {
    throw new HttpError(404, "Conversation not found");
  }

  const messages = await ChatMessage.find({ conversationId: conversation._id })
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  res.status(200).json({
    ok: true,
    conversation,
    messages,
    model: env.llmModel,
    temperature: env.llmTemperature,
  });
});

conversationsRouter.patch("/:id", async (req, res) => {
  ensureDatabaseReady();
  assertValidObjectId(req.params.id);

  const title =
    typeof req.body?.title === "string" ? req.body.title.trim() : "";

  if (!title) {
    throw new HttpError(400, "Please provide a non-empty 'title' string.");
  }

  if (title.length > 120) {
    throw new HttpError(400, "Conversation title cannot exceed 120 characters.");
  }

  const updated = await Conversation.findByIdAndUpdate(
    req.params.id,
    { $set: { title } },
    { returnDocument: "after", runValidators: true }
  ).lean();

  if (!updated) {
    throw new HttpError(404, "Conversation not found");
  }

  res.status(200).json({
    ok: true,
    conversation: updated,
  });
});

conversationsRouter.delete("/:id", async (req, res) => {
  ensureDatabaseReady();
  assertValidObjectId(req.params.id);

  const deleted = await Conversation.findByIdAndDelete(req.params.id).lean();
  if (!deleted) {
    throw new HttpError(404, "Conversation not found");
  }

  const messagesResult = await ChatMessage.deleteMany({
    conversationId: deleted._id,
  });

  res.status(200).json({
    ok: true,
    deletedConversationId: String(deleted._id),
    deletedMessagesCount: messagesResult.deletedCount ?? 0,
  });
});

conversationsRouter.post("/:id/messages", async (req, res) => {
  const result = await sendMessageToConversation({
    conversationId: req.params.id,
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

export { conversationsRouter };

