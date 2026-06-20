/**
 * `useFetch` — generic data-fetching hook built on top of the typed fetch
 * helpers in `../api/http.ts` (e.g. `apiGet`, `apiPost`, …).
 *
 * It owns the request lifecycle so components can stay declarative:
 * - tracks `loading` / `error` / `data` state via `useState`,
 * - re-runs the `fetcher` whenever any entry in `deps` changes,
 * - aborts the in-flight request on unmount, on deps change, and on
 * `refetch()`,
 * - exposes a stable `refetch` callback that callers can attach to buttons
 * or retry handlers.
 *
 * The hook is deliberately unaware of the HTTP verb — the caller wires the
 * fetcher. That keeps `useFetch` decoupled from `http.ts` and easy to
 * compose with `apiGet` / `apiPost` / `apiPut` / `apiDelete`.
 *
 * @example
 * ```tsx
 * import { useFetch } from "../hooks/useFetch";
 * import { apiGet, buildUrl } from "../api/http";
 * import { API_V1_BASE } from "../config/env";
 * import type { AgentSummary } from "../types/agent";
 *
 * function AgentListPage() {
 * const { data, loading, error, refetch } = useFetch<AgentSummary[]>(
 * (signal) => apiGet<AgentSummary[]>(buildUrl(API_V1_BASE, "/agents"), signal),
 * [],
 * );
 * if (loading) return <Spin />;
 * if (error) return <Alert type="error" message={error.message} onClose={refetch} />;
 * return <Table dataSource={data ?? []} />;
 * }
 * ```
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Fetcher receives an `AbortSignal` to forward into `apiGet` / `apiPost` / … */
export type Fetcher<T> = (signal: AbortSignal) => Promise<T>;

/** Public surface of the `useFetch` hook. */
export interface UseFetchResult<T> {
  /** Most recent successful payload, or `null` before the first resolve. */
  data: T | null;
  /** `true` while a request is in flight (including after a `refetch` call). */
  loading: boolean;
  /** Last error thrown by `fetcher`, or `null` if the last call succeeded. */
  error: Error | null;
  /** Imperatively re-run the fetcher with a fresh `AbortSignal`. */
  refetch: () => void;
}

/**
 * Run `fetcher` on mount and whenever any value in `deps` changes.
 *
 * @typeParam T - Shape of the resolved payload.
 * @param fetcher - Receives an `AbortSignal` to forward into the underlying
 * `fetch` call (see `../api/http.ts`).
 * @param deps - Dependency list mirroring `useEffect`'s contract; the fetcher
 * re-runs whenever the identity of any entry changes.
 */
export function useFetch<T>(fetcher: Fetcher<T>, deps: unknown[]): UseFetchResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  // Sequence counter so late responses from an aborted predecessor are
  // ignored even if the abort signal is somehow not honoured downstream.
  const seqRef = useRef<number>(0);
  // Holds the abort handle for the current in-flight request so both the
  // effect cleanup (unmount / re-deps) and `refetch` can cancel it.
  const abortRef = useRef<(() => void) | null>(null);

  const run = useCallback((): void => {
    abortRef.current?.();
    const seq = ++seqRef.current;
    const controller = new AbortController();
    abortRef.current = (): void => controller.abort();

    setLoading(true);
    setError(null);

    fetcher(controller.signal).then(
      (result) => {
        if (seq !== seqRef.current) return;
        setData(result);
        setLoading(false);
      },
      (err: unknown) => {
        if (seq !== seqRef.current) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      },
    );
    // `fetcher` is intentionally omitted: `deps` is the public re-run knob.
    // Callers wrap `fetcher` in `useCallback` when they want stability.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
    return (): void => {
      abortRef.current?.();
      abortRef.current = null;
    };
  }, [run]);

  const refetch = useCallback((): void => {
    run();
  }, [run]);

  return { data, loading, error, refetch };
}