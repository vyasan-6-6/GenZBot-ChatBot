import { Router } from "express";
import { env } from "../config/env.js";
import { listAvailableModels } from "../services/llm.service.js";

const modelsRouter = Router();

modelsRouter.get("/", async (_req, res) => {
  const { ollamaReachable, models } = await listAvailableModels();

  res.status(200).json({
    ok: true,
    defaultModel: env.llmModel,
    ollamaReachable,
    models,
  });
});

export { modelsRouter };

