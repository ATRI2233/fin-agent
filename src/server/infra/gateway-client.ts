/**
 * GatewayClient — WebSocket RPC client for the OpenClaw Gateway.
 *
 * Handles device identity (Ed25519), challenge-response auth,
 * request/response multiplexing, and automatic reconnection.
 */

import WebSocket from "ws";
import * as ed from "@noble/ed25519";
import crypto from "crypto";
import { settings } from "./settings.js";
import { rootLogger } from "./logging.js";

// ── Internal types ──

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
}

interface RpcFrame {
  type: string;
  id?: string;
  method?: string;
  params?: unknown;
  ok?: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
  event?: string;
  [key: string]: unknown;
}

/** Decode WebSocket.Data to a string regardless of the wire format. */
function dataToString(data: WebSocket.Data): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return String(data);
}

// ── GatewayClient ──

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingEntry>();
  private _connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private privateKey: Uint8Array | null = null;
  private publicKey: Uint8Array | null = null;
  private _deviceId: string | null = null;
  private _disconnecting = false;
  private genId = (): string => crypto.randomUUID();
  private sessionTracker = new Map<string, { createdAt: number; ttlMs: number }>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  // ── Public API ──

  get isConnected(): boolean {
    return this._connected;
  }

  /**
   * Connect to the OpenClaw Gateway via WebSocket.
   * Resolves when the connection is fully established (hello received).
   */
  async connect(): Promise<void> {
    if (this._connected && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }

    await this.ensureIdentity();

    return new Promise<void>((resolve, reject) => {
      const url = `ws://${settings.OPENCLAW_GATEWAY_HOST}:${settings.OPENCLAW_GATEWAY_PORT}`;
      rootLogger.info({ url }, "Connecting to OpenClaw Gateway");

      const ws = new WebSocket(url);
      this.ws = ws;
      this._disconnecting = false;

      let connectResolved = false;
      let challengeNonce: string | null = null;

      const connectTimeout = setTimeout(() => {
        if (!connectResolved) {
          reject(new Error("Gateway connection timeout"));
          ws.close();
        }
      }, 15000);

      ws.on("open", () => {
        rootLogger.info("WebSocket connection opened to gateway");
      });

      ws.on("message", async (data: WebSocket.Data) => {
        try {
          const frame: RpcFrame = JSON.parse(dataToString(data));

          // ── Event frames ──
          if (frame.type === "event") {
            if (frame.event === "connect.challenge") {
              challengeNonce = ((frame.payload as { nonce?: string })?.nonce) ?? null;
              if (!challengeNonce) {
                reject(new Error("Missing nonce in connect.challenge"));
                return;
              }

              // Build signed identity proof
              const signedAtMs = Date.now();
              const signPayload = [
                "v2",
                this._deviceId!,
                "node-host",
                "backend",
                "operator",
                "operator.read,operator.write,operator.admin",
                String(signedAtMs),
                "",
                challengeNonce,
              ].join("|");

              const sigBytes = await ed.signAsync(
                new TextEncoder().encode(signPayload),
                this.privateKey!,
              );
              const signature = Buffer.from(sigBytes).toString("base64url");

              const connectReq: RpcFrame = {
                type: "req",
                id: this.genId(),
                method: "connect",
                params: {
                  minProtocol: 4,
                  maxProtocol: 4,
                  client: {
                    id: "node-host",
                    mode: "backend",
                    version: "1.0.0",
                    platform: "win32",
                  },
                  role: "operator",
                  scopes: ["operator.read", "operator.write", "operator.admin"],
                  device: {
                    id: this._deviceId!,
                    publicKey: Buffer.from(this.publicKey!).toString("base64url"),
                    signature,
                    signedAt: signedAtMs,
                    nonce: challengeNonce,
                  },
                  auth: {},
                },
              };

              // Register the connect request as pending so the response gets routed
              const connectTimer = setTimeout(() => {
                this.pending.delete(connectReq.id!);
                reject(new Error("Connect request response timeout"));
              }, 10000);

              this.pending.set(connectReq.id!, {
                resolve: () => {
                  this._connected = true;
                  connectResolved = true;
                  clearTimeout(connectTimeout);
                  clearTimeout(connectTimer);
                  resolve();
                  // Start TTL-based session cleanup (every 12 hours)
                  if (!this.cleanupTimer) {
                    const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
                    this.cleanupTimer = setInterval(() => {
                      this._cleanupExpiredSessions();
                    }, TWELVE_HOURS_MS);
                  }
                },
                reject: (err: unknown) => {
                  connectResolved = true;
                  clearTimeout(connectTimeout);
                  clearTimeout(connectTimer);
                  reject(err);
                },
                timer: connectTimer,
              });

              ws.send(JSON.stringify(connectReq));
            }
            return;
          }

          // ── Response frames (type === "res") ──
          if (frame.type === "res" && frame.id && this.pending.has(frame.id)) {
            const entry = this.pending.get(frame.id)!;
            clearTimeout(entry.timer);
            this.pending.delete(frame.id);

            if (frame.ok) {
              entry.resolve(frame.payload);
            } else {
              entry.reject(new Error(frame.error?.message ?? "RPC error"));
            }
          }
        } catch (err) {
          rootLogger.warn({ err }, "Failed to parse gateway message");
        }
      });

      ws.on("close", () => {
        this._connected = false;

        // Reject all pending requests
        for (const [, entry] of this.pending) {
          clearTimeout(entry.timer);
          entry.reject(new Error("WebSocket closed"));
        }
        this.pending.clear();

        if (!connectResolved) {
          clearTimeout(connectTimeout);
          reject(new Error("WebSocket closed during connection"));
        } else if (!this._disconnecting) {
          this.scheduleReconnect();
        }
      });

      ws.on("error", (err: Error) => {
        rootLogger.warn({ err: err.message }, "Gateway WebSocket error");
        if (!connectResolved) {
          clearTimeout(connectTimeout);
          reject(err);
        }
      });
    });
  }

  /**
   * Send an RPC request and wait for the response.
   * Times out after 30 seconds.
   */
  async request<T = unknown>(method: string, params?: object): Promise<T> {
    if (!this._connected || !this.ws) {
      await this.connect();
    }

    return new Promise<T>((resolve, reject) => {
      const id = this.genId();
      const frame: RpcFrame = { type: "req", id, method, params };

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC request "${method}" timed out after 30s`));
      }, 30000);

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      try {
        this.ws!.send(JSON.stringify(frame));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  /**
   * Inject a message into a gateway session.
   * Logs a warning on failure and does NOT throw.
   */
  async injectMessage(
    sessionKey: string,
    message: string,
    label?: string,
  ): Promise<void> {
    try {
      await this.request("chat.inject", { sessionKey, message, label });
    } catch (err) {
      rootLogger.warn(
        { err, sessionKey },
        "Failed to inject message into gateway session",
      );
    }
  }

  /**
   * Create a child session and return its session key.
   * @returns The session key string (result.key from the gateway response).
   */
  async createSession(
    label?: string,
    parentSessionKey?: string,
    ttl?: number,
  ): Promise<string> {
    const params: Record<string, unknown> = { label, parentSessionKey };
    if (ttl !== undefined) {
      params.ttl = ttl;
    }
    const result = await this.request<{ key: string; sessionId?: string }>(
      "sessions.create",
      params,
    );
    return result.key;
  }

  /** Delete a session by its key. */
  async deleteSession(sessionKey: string): Promise<void> {
    await this.request("sessions.delete", { key: sessionKey });
  }

  /**
   * Track a session for TTL-based auto-cleanup.
   * The session will be deleted via deleteSession() after ttlMs milliseconds.
   */
  trackSession(sessionKey: string, ttlMs: number): void {
    this.sessionTracker.set(sessionKey, { createdAt: Date.now(), ttlMs });
  }

  /** Stop the periodic TTL cleanup timer. */
  stopSessionCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** Disconnect from the gateway and stop reconnection. */
  disconnect(): void {
    this.stopSessionCleanup();
    this._disconnecting = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this._connected = false;
  }

  // ── Private helpers ──

  private async _cleanupExpiredSessions(): Promise<void> {
    const now = Date.now();
    for (const [key, entry] of this.sessionTracker) {
      if (now - entry.createdAt >= entry.ttlMs) {
        try {
          await this.deleteSession(key);
        } catch {
          // Session might already be gone
        }
        this.sessionTracker.delete(key);
      }
    }
  }

  private async ensureIdentity(): Promise<void> {
    if (!this.privateKey) {
      this.privateKey = ed.utils.randomSecretKey();
      this.publicKey = await ed.getPublicKeyAsync(this.privateKey);
      const hash = crypto
        .createHash("sha256")
        .update(Buffer.from(this.publicKey))
        .digest("hex");
      this._deviceId = hash;
    }
  }

  private scheduleReconnect(): void {
    if (this._disconnecting) return;
    if (this.reconnectTimer) return;

    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 30000);
    this.reconnectAttempt++;

    rootLogger.info(
      { delay, attempt: this.reconnectAttempt },
      "Scheduling gateway reconnection",
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
        this.reconnectAttempt = 0;
        rootLogger.info("Reconnected to gateway");
      } catch (err) {
        rootLogger.warn({ err }, "Gateway reconnection failed");
        this.scheduleReconnect();
      }
    }, delay);
  }
}

/** Singleton gateway client instance. */
export const gatewayClient = new GatewayClient();
