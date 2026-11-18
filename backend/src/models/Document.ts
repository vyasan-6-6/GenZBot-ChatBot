import { Schema, model, type InferSchemaType } from "mongoose";

const documentSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    originalName: {
      type: String,
      required: true,
      trim: true,
    },
    mimeType: {
      type: String,
      required: true,
      trim: true,
    },
    sizeBytes: {
      type: Number,
      required: true,
    },
    extractedCharacterCount: {
      type: Number,
      default: 0,
    },
    chunkCount: {
      type: Number,
      default: 0,
    },
    embeddedChunkCount: {
      type: Number,
      default: 0,
    },
    embeddingModel: {
      type: String,
      trim: true,
      default: undefined,
    },
    embeddingDimensions: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["processing", "ready", "failed"],
      default: "processing",
      index: true,
    },
    errorMessage: {
      type: String,
      default: undefined,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: "documents",
  }
);

documentSchema.index({ conversationId: 1, createdAt: -1 });

export type DocumentRecord = InferSchemaType<typeof documentSchema>;

export const DocumentModel = model("Document", documentSchema);
