import { Schema, model, type InferSchemaType } from "mongoose";

const conversationSchema = new Schema(
  {
    sessionKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      default: "default",
    },
    title: {
      type: String,
      required: true,
      trim: true,
      default: "GenZBot Chat",
    },
    systemPrompt: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: "conversations",
  }
);

export type ConversationDocument = InferSchemaType<typeof conversationSchema>;

export const Conversation = model("Conversation", conversationSchema);

