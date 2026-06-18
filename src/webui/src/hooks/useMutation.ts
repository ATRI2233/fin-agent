/**
 * `useMutation` — generic imperative mutator hook for `POST` / `PUT` /
 * `DELETE` operations built on top of the typed fetch helpers in
 * `../api/client.ts`.
 *
 * Unlike {@link useFetch}, this hook never auto-fires: callers trigger the
 * request by invoking `mutate(input)` (e.g. from a form `onFinish` or button
 * `onClick`). The returned promise resolves with the mutator's result, so
 * callers can `await mutate(...)` to chain post-mutation navigation or
 * `toast.success(...)` calls.
 *
 * State semantics:
 * - `loading` flips to `true` on each `mutate` call and back to `false`
 * when the underlying promise settles,
 * - `error` is set to the thrown value (wrapped in `Error` if it isn't
 * already one) when the mutator rejects; it is cleared on the next
 * `mutate`,
 * - state setters are guarded by a mount ref so an in-flight mutation
 * cannot update state after the component unmounts.
 *
 * @example
 * ```tsx
 * import { useMutation } from "../hooks/useMutation";
 * import { apiPost, buildUrl } from "../api/client";
 * import { API_V1_BASE } from "../config/env";
 *
 * interface CreateAgentInput { name: string; prompt: string; }
 * interface Agent { id: string; name: string; }
 *
 * function CreateAgentButton() {
 * const { mutate, loading, error } = useMutation<CreateAgentInput, Agent>(
 * (input) => apiPost<Agent>(buildUrl(API_V1_BASE, "/agents"), input),
 * );
 * return (
 * <Button
 * loading={loading}
 * onClick={() =>
 * mutate({ name: "macro-scout", prompt: "..." })
 * .then((agent) => message.success(`Created ${agent.id}`))
 * .catch(() => undefined)
 * }
 * >
 * Create agent
 * </Button>
 * );
 * }
 * ```
 */

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Mutator receives only the caller-supplied `input`. This matches the
 * declarative shape of `apiPost` / `apiPut` / `apiDelete` after the request
 * body / URL are baked in by the caller's closure.
 */
export type Mutator<TInput, TOutput> = (input: TInput) => Promise<TOutput>;

/** Public surface of the `useMutation` hook. */
export interface UseMutationResult<TInput, TOutput> {
  /** Fire the mutator with `input`; returns a promise that mirrors the mutator's. */
  mutate: (input: TInput) => Promise<TOutput>;
  /** `true` while a mutate call is in flight. */
  loading: boolean;
  /** Last error thrown by `mutator`, or `null` if it succeeded (or none yet). */
  error: Error | null;
}

/**
 * Track the imperative lifecycle of a mutation.
 *
 * @typeParam TInput - Shape of the argument passed to `mutate`.
 * @typeParam TOutput - Shape of the mutator's resolved value.
 * @param mutator - Callback that performs the side-effecting request.
 */
export function useMutation<TInput, TOutput>(
  mutator: Mutator<TInput, TOutput>,
): UseMutationResult<TInput, TOutput> {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Mount guard so an in-flight mutation cannot `setState` after unmount.
  const mountedRef = useRef<boolean>(true);
  useEffect(() => {
    mountedRef.current = true;
    return (): void => {
      mountedRef.current = false;
    };
  }, []);

  const mutate = useCallback(
    (input: TInput): Promise<TOutput> => {
      setLoading(true);
      setError(null);
      return mutator(input).then(
        (result) => {
          if (mountedRef.current) setLoading(false);
          return result;
        },
        (err: unknown) => {
          if (mountedRef.current) {
            setError(err instanceof Error ? err : new Error(String(err)));
            setLoading(false);
          }
          throw err;
        },
      );
    },
    [mutator],
  );

  return { mutate, loading, error };
}