import http from "node:http";
import { createApp } from "./app.js";
import { connectToDatabase, disconnectFromDatabase } from "./config/db.js";
import { env } from "./config/env.js";

async function startServer(): Promise<void> {
  await connectToDatabase();

  const app = createApp();
  const server = http.createServer(app);

  server.listen(env.port, () => {
    console.log(
      `[Express] Server listening on http://localhost:${env.port} (${env.nodeEnv})`
    );
    console.log(`[Express] Allowing CORS origin: ${env.clientUrl}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
    server.close(async (closeError) => {
      if (closeError) {
        console.error("[Server] Error closing HTTP server:", closeError);
        process.exit(1);
      }

      try {
        await disconnectFromDatabase();
        console.log("[Server] Shutdown complete.");
        process.exit(0);
      } catch (dbError) {
        console.error("[Server] Error disconnecting from MongoDB:", dbError);
        process.exit(1);
      }
    });
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

startServer().catch((error) => {
  console.error("[Server] Fatal startup error:", error);
  process.exit(1);
});

