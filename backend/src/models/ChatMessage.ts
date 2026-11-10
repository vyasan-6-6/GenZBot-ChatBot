import { Schema, model, type InferSchemaType } from "mongoose";

const tokenUsageSchema = new Schema(
  {
    promptTokens: { type: Number },
    completionTokens: { type: Number },
    totalTokens: { type: Number },
  },
  { _id: false }
);

const chatMessageSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    role: {
      type: String,
      required: true,
      enum: ["user", "assistant"],
    },
    content: {
      type: String,
      required: [true, "Message content is required"],
      trim: true,
      minlength: [1, "Message content cannot be empty"],
      maxlength: [16000, "Message content cannot exceed 16000 characters"],
    },
    model: {
      type: String,
      trim: true,
    },
    usage: {
      type: tokenUsageSchema,
      default: undefined,
    },
    durationMs: {
      type: Number,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: "chat_messages",
  }
);

chatMessageSchema.index({ conversationId: 1, createdAt: 1, _id: 1 });

export type ChatMessageDocument = InferSchemaType<typeof chatMessageSchema>;

export const ChatMessage = model("ChatMessage", chatMessageSchema);

