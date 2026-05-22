import { useCallback, useEffect, useRef } from "react";

/**
 * Returns a `getSignal` function. Each call aborts the previous signal and
 * mints a fresh `AbortController`, so calling it for a new async operation
 * cleanly cancels any in-flight one from this component. The latest
 * signal is also aborted automatically when the component unmounts.
 *
 *   const getSignal = useAbortOnUnmount();
 *   const onSend = async () => {
 *     const signal = getSignal();
 *     const { data } = await invokeAiCached("ai-assist", body, { signal });
 *     if (signal.aborted) return;     // navigated away mid-call
 *     setReply(data);
 *   };
 *
 * Use when you fire an async request from a handler and want to ignore the
 * response if the user leaves the screen or fires a newer request. Keeps
 * the underlying request alive in the shared `invokeAiCached` cache, so
 * other consumers (or a returning user) still benefit from the result.
 */
export function useAbortOnUnmount(): () => AbortSignal {
  const ref = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      ref.current?.abort();
      ref.current = null;
    };
  }, []);

  return useCallback(() => {
    ref.current?.abort();
    const next = new AbortController();
    ref.current = next;
    return next.signal;
  }, []);
}
