import { Router } from "express";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { HttpError } from "../middleware/errorHandler.js";
import { ChatMessage } from "../models/ChatMessage.js";
import { Conversation } from "../models/Conversation.js";
import {
  ensureDatabaseReady,
  regenerateConversationTitle,
  sendMessageToConversation,
  streamMessageToConversation,
  validateModelInput,
} from "../services/chat.service.js";

const conversationsRouter = Router();

function assertValidObjectId(id: string): void {
  if (!mongoose.isValidObjectId(id)) {
    throw new HttpError(400, "Invalid conversation ID");
  }
}

function writeSseEvent(
  res: { write: (chunk: string) => boolean },
  event: string,
  data: unknown
): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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
  const hasCustomTitle = rawTitle.length > 0;
  const title = hasCustomTitle ? rawTitle : "New Chat";

  if (title.length > 120) {
    throw new HttpError(400, "Conversation title cannot exceed 120 characters.");
  }

  const rawSystemPrompt =
    typeof req.body?.systemPrompt === "string"
      ? req.body.systemPrompt.trim()
      : "";

  const model = validateModelInput(req.body?.model) ?? env.llmModel;

  const conversation = await Conversation.create({
    title,
    titleSource: hasCustomTitle ? "manual" : "default",
    systemPrompt: rawSystemPrompt || env.llmSystemPrompt,
    model,
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
    model: conversation.model ?? env.llmModel,
    temperature: env.llmTemperature,
  });
});

conversationsRouter.patch("/:id", async (req, res) => {
  ensureDatabaseReady();
  assertValidObjectId(req.params.id);

  const updates: Record<string, unknown> = {};

  if (req.body?.title !== undefined) {
    const title =
      typeof req.body.title === "string" ? req.body.title.trim() : "";
    if (!title) {
      throw new HttpError(400, "Please provide a non-empty 'title' string.");
    }
    if (title.length > 120) {
      throw new HttpError(
        400,
        "Conversation title cannot exceed 120 characters."
      );
    }
    updates.title = title;
    updates.titleSource = "manual";
  }

  if (req.body?.model !== undefined) {
    updates.model = validateModelInput(req.body.model);
  }

  if (Object.keys(updates).length === 0) {
    throw new HttpError(
      400,
      "Provide at least one field to update ('title' or 'model')."
    );
  }

  const updated = await Conversation.findByIdAndUpdate(
    req.params.id,
    { $set: updates },
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

conversationsRouter.post("/:id/title", async (req, res) => {
  const conversation = await regenerateConversationTitle(req.params.id);

  res.status(200).json({
    ok: true,
    conversation,
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
    model: req.body?.model,
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

conversationsRouter.post("/:id/messages/stream", async (req, res, next) => {
  const abortController = new AbortController();
  let streamStarted = false;

  res.on("close", () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  try {
    const result = await streamMessageToConversation({
      conversationId: req.params.id,
      message: req.body?.message,
      temperature: req.body?.temperature,
      model: req.body?.model,
      signal: abortController.signal,
      onStart: (meta) => {
        streamStarted = true;
        res.status(200);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
        writeSseEvent(res, "start", meta);
      },
      onToken: (token) => {
        if (!abortController.signal.aborted && !res.writableEnded) {
          writeSseEvent(res, "delta", { content: token });
        }
      },
    });

    if (!abortController.signal.aborted && !res.writableEnded) {
      writeSseEvent(res, "done", {
        ok: true,
        conversationId: result.conversation._id,
        conversation: result.conversation,
        userMessage: result.userMessage,
        assistantMessage: result.assistantMessage,
        meta: result.meta,
      });
      res.end();
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      if (!res.writableEnded) {
        res.end();
      }
      return;
    }

    if (!streamStarted && !res.headersSent) {
      next(error);
      return;
    }

    if (!res.writableEnded) {
      const message =
        error instanceof Error ? error.message : "Streaming error";
      writeSseEvent(res, "error", { ok: false, error: message });
      res.end();
    }
  }
});

export { conversationsRouter };
