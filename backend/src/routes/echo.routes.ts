import { Router } from "express";
import { EchoEntry } from "../models/EchoEntry.js";

const echoRouter = Router();

echoRouter.get("/", async (_req, res) => {
  const items = await EchoEntry.find()
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  res.status(200).json({
    ok: true,
    count: items.length,
    items,
  });
});

echoRouter.post("/", async (req, res) => {
  const rawMessage =
    typeof req.body?.message === "string" ? req.body.message.trim() : "";

  if (!rawMessage) {
    res.status(400).json({
      ok: false,
      error: "Please provide a non-empty 'message' string.",
    });
    return;
  }

  const created = await EchoEntry.create({
    message: rawMessage,
    source: "nextjs-frontend",
  });

  res.status(201).json({
    ok: true,
    item: created.toObject(),
  });
});

export { echoRouter };

