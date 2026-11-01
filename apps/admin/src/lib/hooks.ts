import { useCallback, useEffect, useState } from "react";
import { RequestError } from "./api";

/** Minimal data loader: { data, error, loading, reload, setData }. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<RequestError | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(loader, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await run());
    } catch (e) {
      setError(e instanceof RequestError ? e : new RequestError(0, "unknown", String(e)));
    } finally {
      setLoading(false);
    }
  }, [run]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

/** Form submit helper: tracks pending state, field errors and a general error message. */
export function useSubmit<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const submit = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setPending(true);
      setFields({});
      setMessage(null);
      try {
        return await fn(...args);
      } catch (e) {
        if (e instanceof RequestError) {
          setFields(e.fields);
          if (!Object.keys(e.fields).length || e.code !== "validation_error") setMessage(e.message);
        } else setMessage("Ocurrió un error inesperado");
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [fn],
  );
  /** Removes field errors as the user edits them (exact path or any path under it). */
  const clearFields = useCallback((...paths: string[]) => {
    setFields((all) => {
      const keys = Object.keys(all).filter((k) => paths.some((p) => k === p || k.startsWith(`${p}.`)));
      if (!keys.length) return all;
      const next = { ...all };
      keys.forEach((k) => delete next[k]);
      return next;
    });
  }, []);
  return { submit, pending, fields, message, setMessage, clearFields };
}
