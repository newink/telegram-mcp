import { log } from "./logger.ts";
import { startServer } from "./server.ts";

startServer().catch((err) => {
  log.fatal({ err }, "fatal error");
  process.exit(1);
});
