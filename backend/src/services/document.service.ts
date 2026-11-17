import mongoose from "mongoose";
import { PDFParse } from "pdf-parse";
import { HttpError } from "../middleware/errorHandler.js";
import { Conversation } from "../models/Conversation.js";
import { DocumentModel } from "../models/Document.js";
import { DocumentChunkModel } from "../models/DocumentChunk.js";

export interface GeneratedChunk {
  chunkIndex: number;
  text: string;
  characterCount: number;
}

export function cleanExtractedText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractTextFromFile(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<string> {
  const isPdf =
    mimeType === "application/pdf" ||
    fileName.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    try {
      const parser = new PDFParse({ data: buffer });
      const parsedText = await parser.getText();
      await parser.destroy();

      const cleaned = cleanExtractedText(parsedText?.text ?? "");
      if (!cleaned) {
        throw new HttpError(
          400,
          "No readable text could be extracted from this PDF. It may be scanned or empty."
        );
      }
      return cleaned;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(
        400,
        `Failed to parse PDF document: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Plain text, Markdown, CSV, JSON, etc.
  const decoded = buffer.toString("utf-8");
  const cleaned = cleanExtractedText(decoded);
  if (!cleaned) {
    throw new HttpError(400, "The uploaded text file is empty.");
  }
  return cleaned;
}

/**
 * Smart recursive chunker that splits text into overlapping windows
 * respecting paragraph and sentence boundaries wherever possible.
 */
export function chunkText(
  fullText: string,
  options: { chunkSize?: number; chunkOverlap?: number } = {}
): GeneratedChunk[] {
  const chunkSize = options.chunkSize ?? 750;
  const chunkOverlap = options.chunkOverlap ?? 120;

  if (fullText.length <= chunkSize) {
    return [
      {
        chunkIndex: 0,
        text: fullText,
        characterCount: fullText.length,
      },
    ];
  }

  const chunks: GeneratedChunk[] = [];
  let startIndex = 0;
  let chunkIndex = 0;

  while (startIndex < fullText.length) {
    let endIndex = startIndex + chunkSize;

    if (endIndex >= fullText.length) {
      endIndex = fullText.length;
    } else {
      // Look for natural boundary near endIndex:
      // 1. Paragraph break (\n\n)
      // 2. Sentence boundary (. ! ?)
      // 3. Line break (\n)
      // 4. Space
      const searchWindow = fullText.slice(
        Math.max(startIndex, endIndex - 100),
        Math.min(fullText.length, endIndex + 50)
      );

      const offsetStart = Math.max(startIndex, endIndex - 100);
      const paraBreak = fullText.lastIndexOf("\n\n", endIndex);
      const sentenceBreak = fullText.lastIndexOf(". ", endIndex);
      const newlineBreak = fullText.lastIndexOf("\n", endIndex);
      const spaceBreak = fullText.lastIndexOf(" ", endIndex);

      if (paraBreak > offsetStart) {
        endIndex = paraBreak + 2;
      } else if (sentenceBreak > offsetStart) {
        endIndex = sentenceBreak + 2;
      } else if (newlineBreak > offsetStart) {
        endIndex = newlineBreak + 1;
      } else if (spaceBreak > offsetStart) {
        endIndex = spaceBreak + 1;
      }
    }

    const chunkContent = fullText.slice(startIndex, endIndex).trim();
    if (chunkContent.length > 0) {
      chunks.push({
        chunkIndex,
        text: chunkContent,
        characterCount: chunkContent.length,
      });
      chunkIndex++;
    }

    if (endIndex >= fullText.length) {
      break;
    }

    // Advance start index with overlap
    startIndex = Math.max(startIndex + 1, endIndex - chunkOverlap);
  }

  return chunks;
}

export async function processAndStoreDocument(params: {
  conversationId: string;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}) {
  const { conversationId, fileBuffer, fileName, mimeType, sizeBytes } = params;

  if (!mongoose.isValidObjectId(conversationId)) {
    throw new HttpError(400, "Invalid conversation ID");
  }

  const conversation = await Conversation.findById(conversationId).lean();
  if (!conversation) {
    throw new HttpError(404, "Conversation not found");
  }

  // Initial Document record
  const docRecord = await DocumentModel.create({
    conversationId: conversation._id,
    fileName,
    originalName: fileName,
    mimeType,
    sizeBytes,
    status: "processing",
  });

  try {
    const extractedText = await extractTextFromFile(
      fileBuffer,
      mimeType,
      fileName
    );

    const generatedChunks = chunkText(extractedText);

    if (generatedChunks.length === 0) {
      throw new HttpError(400, "Document did not yield any usable text chunks.");
    }

    const chunkDocs = generatedChunks.map((c) => ({
      documentId: docRecord._id,
      conversationId: conversation._id,
      chunkIndex: c.chunkIndex,
      text: c.text,
      characterCount: c.characterCount,
      metadata: {
        fileName,
        chunkIndex: c.chunkIndex,
        totalChunks: generatedChunks.length,
      },
    }));

    await DocumentChunkModel.insertMany(chunkDocs);

    const updatedDoc = await DocumentModel.findByIdAndUpdate(
      docRecord._id,
      {
        $set: {
          status: "ready",
          extractedCharacterCount: extractedText.length,
          chunkCount: generatedChunks.length,
        },
      },
      { returnDocument: "after" }
    ).lean();

    return {
      document: updatedDoc ?? docRecord.toObject(),
      chunks: generatedChunks,
    };
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : "Failed to process document";
    await DocumentModel.findByIdAndUpdate(docRecord._id, {
      $set: {
        status: "failed",
        errorMessage: errorMsg,
      },
    });
    throw error;
  }
}

export async function listConversationDocuments(conversationId: string) {
  if (!mongoose.isValidObjectId(conversationId)) {
    throw new HttpError(400, "Invalid conversation ID");
  }

  return DocumentModel.find({ conversationId })
    .sort({ createdAt: -1 })
    .lean();
}

export async function getDocumentChunks(documentId: string) {
  if (!mongoose.isValidObjectId(documentId)) {
    throw new HttpError(400, "Invalid document ID");
  }

  const doc = await DocumentModel.findById(documentId).lean();
  if (!doc) {
    throw new HttpError(404, "Document not found");
  }

  const chunks = await DocumentChunkModel.find({ documentId })
    .sort({ chunkIndex: 1 })
    .lean();

  return {
    document: doc,
    chunks,
  };
}

export async function deleteDocumentAndChunks(documentId: string) {
  if (!mongoose.isValidObjectId(documentId)) {
    throw new HttpError(400, "Invalid document ID");
  }

  const doc = await DocumentModel.findById(documentId).lean();
  if (!doc) {
    throw new HttpError(404, "Document not found");
  }

  const [chunksResult] = await Promise.all([
    DocumentChunkModel.deleteMany({ documentId: doc._id }),
    DocumentModel.findByIdAndDelete(doc._id),
  ]);

  return {
    deletedDocumentId: String(doc._id),
    deletedChunksCount: chunksResult.deletedCount ?? 0,
  };
}
