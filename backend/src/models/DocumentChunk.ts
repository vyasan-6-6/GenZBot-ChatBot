import { Schema, model, type InferSchemaType } from "mongoose";

const documentChunkSchema = new Schema(
  {
    documentId: {
      type: Schema.Types.ObjectId,
      ref: "Document",
      required: true,
      index: true,
    },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    chunkIndex: {
      type: Number,
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
    characterCount: {
      type: Number,
      required: true,
    },
    metadata: {
      fileName: { type: String, required: true },
      chunkIndex: { type: Number, required: true },
      totalChunks: { type: Number, required: true },
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: "document_chunks",
  }
);

documentChunkSchema.index({ documentId: 1, chunkIndex: 1 }, { unique: true });
documentChunkSchema.index({ conversationId: 1, createdAt: 1 });

export type DocumentChunkRecord = InferSchemaType<typeof documentChunkSchema>;

export const DocumentChunkModel = model("DocumentChunk", documentChunkSchema);
