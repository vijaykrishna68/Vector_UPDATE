import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Data loading with explicit states and stale-request protection.
 *
 * - every run gets a fresh AbortController, so switching week or view cancels the
 *   in-flight request instead of letting a late response overwrite fresh data
 * - AbortError is swallowed (it is expected), every other failure surfaces
 * - failures are NEVER converted into empty data; status becomes 'error'
 *
 * `key` identifies the request. Changing it re-fetches. The fetcher is held in a
 * ref so an inline arrow function does not retrigger the effect on every render.
 *
 * @param {(signal: AbortSignal) => Promise<unknown>} fetcher
 * @param {string} key
 * @param {{ enabled?: boolean }} [options]
 */
export function useAsync(fetcher, key, { enabled = true } = {}) {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [state, setState] = useState(() => ({
    status: enabled ? 'loading' : 'idle',
    data: null,
    error: null
  }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle', data: null, error: null });
      return undefined;
    }

    const controller = new AbortController();
    let current = true;

    setState((prev) => ({ status: 'loading', data: prev.data, error: null }));

    fetcherRef
      .current(controller.signal)
      .then((data) => {
        if (current) setState({ status: 'success', data, error: null });
      })
      .catch((error) => {
        if (error?.name === 'AbortError' || !current) return;
        setState({ status: 'error', data: null, error });
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [key, attempt, enabled]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    ...state,
    isLoading: state.status === 'loading',
    isError: state.status === 'error',
    isSuccess: state.status === 'success',
    retry
  };
}
