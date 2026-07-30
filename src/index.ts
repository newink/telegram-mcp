import { applyEnvFileToProcess } from "./env.ts";
import { log } from "./logger.ts";
import { startServer } from "./server.ts";

applyEnvFileToProcess();

startServer().catch((err) => {
  log.fatal({ err }, "fatal error");
  process.exit(1);
});
