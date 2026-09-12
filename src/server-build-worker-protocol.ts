// Messages between the build process and `server-build-worker`.

export type ServerBuildWorkerData = {
  serverBuildPath: string;
  mode: 'classic' | 'rsc';
};

export type ServerBuildWorkerRequest =
  | { id: number; type: 'describe' }
  | {
      id: number;
      type: 'request';
      url: string;
      method: string;
      headers: [string, string][];
      body?: Uint8Array;
    };

export type SerializedResponse = {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: Uint8Array;
};

export type SerializedError = {
  message: string;
  stack?: string;
  name?: string;
};

export type ServerBuildWorkerResponse =
  | { id: number; ok: true; ready: true }
  | { id: number; ok: true; description?: ServerBuildDescription }
  | { id: number; ok: true; response: SerializedResponse }
  | { id: number; ok: false; error: SerializedError };

/**
 * The parts of a classic React Router server build that build-time rendering
 * reads, as plain data: route module exports are reported by presence only.
 */
export type ServerBuildDescription = {
  basename?: string;
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
