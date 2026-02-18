import { startServer } from "./server.ts";

startServer().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
