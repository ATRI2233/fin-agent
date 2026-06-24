import pino from "pino";
import { settings } from "./settings.js";

export function createLogger(name: string) {
  return pino({
    name,
    level: settings.LOG_LEVEL.toLowerCase(),
    formatters: {
      level(label: string) {
        return { level: label.toUpperCase() };
      },
    },
    base: {
      pid: process.pid,
      version: "2.1",
    },
  });
}

export const rootLogger = createLogger("fin-agent");
