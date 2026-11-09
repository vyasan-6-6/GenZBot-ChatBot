import { Schema, model, type InferSchemaType } from "mongoose";

const echoEntrySchema = new Schema(
  {
    message: {
      type: String,
      required: [true, "Message is required"],
      trim: true,
      minlength: [1, "Message cannot be empty"],
      maxlength: [280, "Message cannot exceed 280 characters"],
    },
    source: {
      type: String,
      default: "nextjs-frontend",
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: "echo_entries",
  }
);

export type EchoEntryDocument = InferSchemaType<typeof echoEntrySchema>;

export const EchoEntry = model("EchoEntry", echoEntrySchema);

