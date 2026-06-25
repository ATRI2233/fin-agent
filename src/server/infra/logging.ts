import { readFileSync } from "fs";
import pino from "pino";
import { settings } from "./settings.js";

const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf-8"));
export const APP_VERSION: string = pkg.version;

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
      version: APP_VERSION,
    },
  });
}

export const rootLogger = createLogger("fin-agent");
