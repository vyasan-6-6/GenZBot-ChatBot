import { randomUUID } from "node:crypto";
import { Schema, model, type InferSchemaType } from "mongoose";

const conversationSchema = new Schema(
  {
    sessionKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      default: () => randomUUID(),
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: [120, "Conversation title cannot exceed 120 characters"],
      default: "New Chat",
    },
    titleSource: {
      type: String,
      enum: ["default", "auto", "manual"],
      default: "default",
    },
    systemPrompt: {
      type: String,
      trim: true,
    },
    model: {
      type: String,
      trim: true,
      maxlength: [100, "Model name cannot exceed 100 characters"],
    },
    lastMessagePreview: {
      type: String,
      trim: true,
      maxlength: 160,
    },
    messageCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: "conversations",
  }
);

conversationSchema.index({ updatedAt: -1, _id: -1 });

export type ConversationDocument = InferSchemaType<typeof conversationSchema>;

export const Conversation = model("Conversation", conversationSchema);

