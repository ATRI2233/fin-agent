/**
 * UI-only type primitives.
 *
 * Generic shapes shared across pages for common interaction patterns:
 * async data fetching, paginated lists, modal dialogs, and form state.
 * Decoupled from backend DTOs so call sites can compose them with
 * view-models from `agent.ts`, `conversation.ts`, etc.
 */

/**
 * Async operation envelope tracking payload, in-flight flag, and error.
 *
 * @typeParam T - Resolved data shape; defaults to `void` for mutations.
 */
export interface AsyncState<T = void> {
  /** Resolved payload, or `null` before the first successful fetch. */
  data: T | null;
  /** `true` while a request is in flight. */
  loading: boolean;
  /** Human-readable error message, or `null` when none. */
  error: string | null;
}

/**
 * Query parameters for paginated list endpoints.
 *
 * Mirrors FastAPI's `skip` / `limit` convention (`framework/api/*`).
 * All fields optional; supply defaults like `skip = 0`, `limit = 20`.
 */
export interface PaginationParams {
  /** Records to skip from the start of the result set. */
  skip?: number;
  /** Maximum records to return. */
  limit?: number;
}

/**
 * Paginated response envelope returned by list endpoints.
 *
 * @typeParam T - Element type of `items`.
 */
export interface PaginatedResponse<T> {
  /** Records for the current page. */
  items: T[];
  /** Total record count across all pages. */
  total: number;
  /** Echo of the `skip` used for this page. */
  skip: number;
  /** Echo of the `limit` used for this page. */
  limit: number;
}

/**
 * Modal/dialog state container with entity binding and operation mode.
 *
 * `mode = null` (and typically `data = null`) indicates the modal is
 * closed.
 *
 * @typeParam T - Shape of the entity bound to the modal.
 */
export interface ModalState<T> {
  /** Whether the modal is currently rendered. */
  visible: boolean;
  /** Bound entity, or `null` when none is selected. */
  data: T | null;
  /** Operation mode; `null` when the modal is closed. */
  mode: "create" | "edit" | "view" | null;
}

/**
 * Helper alias for form state in `useState<FormState<T>>(initial)`.
 *
 * Defaults to `Partial<T>` so unset fields are permitted during input.
 *
 * @typeParam T - Canonical entity type being edited.
 */
export type FormState<T> = Partial<T>;
