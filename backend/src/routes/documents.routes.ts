import { Router } from "express";
import multer from "multer";
import { HttpError } from "../middleware/errorHandler.js";
import {
  deleteDocumentAndChunks,
  getDocumentChunks,
  listConversationDocuments,
  processAndStoreDocument,
} from "../services/document.service.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = new Set([
      "application/pdf",
      "text/plain",
      "text/markdown",
      "text/csv",
      "application/json",
      "application/octet-stream",
    ]);

    const allowedExtensions = [".pdf", ".txt", ".md", ".csv", ".json"];
    const hasAllowedExt = allowedExtensions.some((ext) =>
      file.originalname.toLowerCase().endsWith(ext)
    );

    if (allowedMimeTypes.has(file.mimetype) || hasAllowedExt) {
      cb(null, true);
    } else {
      cb(
        new HttpError(
          400,
          "Unsupported file type. Please upload a PDF (.pdf), Text (.txt), or Markdown (.md) file."
        )
      );
    }
  },
});

function getSingleParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] ?? "";
  return param ?? "";
}

export const documentsRouter = Router({ mergeParams: true });

// Upload document to conversation
documentsRouter.post(
  "/conversations/:conversationId/documents",
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      throw new HttpError(400, "Please provide a file under the 'file' field.");
    }

    const conversationId = getSingleParam(req.params.conversationId);
    const result = await processAndStoreDocument({
      conversationId,
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    });

    res.status(201).json({
      ok: true,
      document: result.document,
      chunkCount: result.chunks.length,
      chunksPreview: result.chunks.slice(0, 3),
    });
  }
);

// List documents for conversation
documentsRouter.get(
  "/conversations/:conversationId/documents",
  async (req, res) => {
    const conversationId = getSingleParam(req.params.conversationId);
    const documents = await listConversationDocuments(conversationId);

    res.status(200).json({
      ok: true,
      documents,
    });
  }
);

// Get document chunks (for diagnostic preview)
documentsRouter.get("/documents/:documentId/chunks", async (req, res) => {
  const documentId = getSingleParam(req.params.documentId);
  const result = await getDocumentChunks(documentId);

  res.status(200).json({
    ok: true,
    document: result.document,
    chunks: result.chunks,
  });
});

// Delete document and chunks
documentsRouter.delete("/documents/:documentId", async (req, res) => {
  const documentId = getSingleParam(req.params.documentId);
  const result = await deleteDocumentAndChunks(documentId);

  res.status(200).json({
    ok: true,
    ...result,
  });
});
