// Messages between the build process and `server-build-worker`.

/** Headers as a structured-cloneable list (the DOM lib's Headers is not iterable here). */
export const headerEntries = (headers: Headers): [string, string][] => {
  const entries: [string, string][] = [];
  headers.forEach((value, key) => entries.push([key, value]));
  return entries;
};

export type ServerBuildWorkerData = {
  serverBuildPath: string;
  mode: 'classic' | 'rsc';
};

export type ServerBuildWorkerRequest =
  | {
      id: number;
      type: 'request';
      url: string;
      method: string;
      headers: [string, string][];
      body?: Uint8Array<ArrayBuffer>;
    }
  /** The parent released the request before a reply arrived. */
  | { id: number; type: 'abort' };

export type SerializedResponse = {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: Uint8Array<ArrayBuffer>;
};

export type SerializedError = {
  message: string;
  stack?: string;
  name?: string;
};

export type ServerBuildWorkerResponse =
  /** Sent once the bundle is evaluated; carries the classic build description. */
  | { type: 'ready'; description?: ServerBuildDescription }
  | { type: 'reply'; id: number; ok: true; response: SerializedResponse }
  | { type: 'reply'; id: number; ok: false; error: SerializedError };

/**
 * The parts of a classic React Router server build that build-time rendering
 * reads, as plain data: route module exports are reported by presence only.
 */
export type ServerBuildDescription = {
  prerender?: string[];
  routes: Record<
    string,
    {
      id?: string;
      parentId?: string;
      path?: string;
      index?: boolean;
      caseSensitive?: boolean;
      module: { default: boolean; ErrorBoundary: boolean; loader: boolean };
    }
  >;
  assets: { routes: Record<string, { hasLoader?: boolean }> };
};
