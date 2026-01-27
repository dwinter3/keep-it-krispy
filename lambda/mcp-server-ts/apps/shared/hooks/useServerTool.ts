import { useCallback, useState } from 'react';
import type { App } from '@modelcontextprotocol/ext-apps';

interface UseServerToolResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  execute: (args?: Record<string, unknown>) => Promise<T | null>;
  reset: () => void;
}

export function useServerTool<T>(
  app: App | null,
  toolName: string,
  parseResult?: (text: string) => T
): UseServerToolResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (args?: Record<string, unknown>) => {
    if (!app) return null;
    setLoading(true);
    setError(null);
    try {
      const result = await app.callServerTool({
        name: toolName,
        arguments: args || {},
      });
      const text = (result.content as Array<{ type: string; text?: string }>)?.find(
        (c) => c.type === 'text'
      )?.text;
      if (text) {
        const parsed = parseResult ? parseResult(text) : (JSON.parse(text) as T);
        setData(parsed);
        return parsed;
      }
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Tool call failed';
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, [app, toolName, parseResult]);

  const reset = useCallback(() => {
    setData(null);
    setLoading(false);
    setError(null);
  }, []);

  return { data, loading, error, execute, reset };
}
