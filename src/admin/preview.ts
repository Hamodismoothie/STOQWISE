/**
 * Preview switch.
 *
 * The renderers are synchronous, so a module-scoped flag safely marks the
 * duration of one draft render: the public pages then read draft values instead
 * of published ones. Admin routes only, never on a public request path.
 */
import type { ContentMode } from "./store.ts";

let mode: ContentMode = "published";

export function previewMode(): ContentMode {
  return mode;
}

export function withDraft<T>(fn: () => T): T {
  const previous = mode;
  mode = "draft";
  try {
    return fn();
  } finally {
    mode = previous;
  }
}
