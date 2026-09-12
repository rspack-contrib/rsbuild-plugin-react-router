import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type {
  ServerBuildDescription,
  ServerBuildWorkerData,
  ServerBuildWorkerRequest,
  ServerBuildWorkerResponse,
} from './server-build-worker-protocol.js';

const workerPath = fileURLToPath(
  new URL('./server-build-worker.js', import.meta.url)
);

export type ServerBuildWorker = {
  /** Plain-data view of the classic server build (routes, assets, prerender). */
  describe(): Promise<ServerBuildDescription>;
  /** Runs the request against the server build in the worker. */
  handler(request: Request): Promise<Response>;
  /** Terminates the worker, and with it any handle the server graph opened. */
  close(): Promise<void>;
};

type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never;

const headerEntries = (headers: Headers): [string, string][] => {
  const entries: [string, string][] = [];
  headers.forEach((value, key) => entries.push([key, value]));
  return entries;
};

type Pending = {
  resolve: (message: ServerBuildWorkerResponse) => void;
  reject: (error: Error) => void;
};

/**
 * Evaluate a built server bundle in a worker thread and proxy requests to it.
 * Build-time rendering used to `import()` the bundle into the build process;
 * a module-scope handle in the app's server graph then kept `rsbuild build`
 * alive forever (#135). The worker is terminated by `close()`.
 */
export const startServerBuildWorker = async (
  data: ServerBuildWorkerData
): Promise<ServerBuildWorker> => {
  const worker = new Worker(workerPath, { workerData: data });
  const pending = new Map<number, Pending>();
  let nextId = 0;
  let failure: Error | undefined;

  const failAll = (error: Error): void => {
    failure = error;
    for (const { reject } of pending.values()) {
      reject(error);
    }
    pending.clear();
  };

  worker.on('message', (message: ServerBuildWorkerResponse) => {
    const entry = pending.get(message.id);
    if (!entry) {
      return;
    }
    pending.delete(message.id);
    entry.resolve(message);
  });
  worker.on('error', error =>
    failAll(error instanceof Error ? error : new Error(String(error)))
  );
  worker.on('exit', code => {
    if (pending.size > 0) {
      failAll(
        new Error(
          `Server build worker exited with code ${code} while rendering`
        )
      );
    }
  });

  const send = (
    request: DistributiveOmit<ServerBuildWorkerRequest, 'id'>,
    transfer: ArrayBuffer[] = []
  ): Promise<ServerBuildWorkerResponse> =>
    new Promise((resolve, reject) => {
      if (failure) {
        reject(failure);
        return;
      }
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...request, id }, transfer);
    });

  const toError = (message: ServerBuildWorkerResponse): Error => {
    if (message.ok) {
      return new Error('Unexpected server build worker reply');
    }
    const error = new Error(message.error.message);
    error.name = message.error.name ?? error.name;
    if (message.error.stack) {
      error.stack = message.error.stack;
    }
    return error;
  };

  // Wait for the bundle to be evaluated; import errors surface as worker
  // 'error' events, which reject this pending entry.
  await new Promise<void>((resolve, reject) => {
    pending.set(-1, {
      resolve: message => (message.ok ? resolve() : reject(toError(message))),
      reject,
    });
  });

  return {
    async describe() {
      const message = await send({ type: 'describe' });
      if (!message.ok) {
        throw toError(message);
      }
      if (!('description' in message) || !message.description) {
        throw new Error('Server build worker has no build description');
      }
      return message.description;
    },
    async handler(request) {
      const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
      const body = hasBody
        ? new Uint8Array(await request.arrayBuffer())
        : undefined;
      const message = await send(
        {
          type: 'request',
          url: request.url,
          method: request.method,
          headers: headerEntries(request.headers),
          body,
        },
        body ? [body.buffer as ArrayBuffer] : []
      );
      if (!message.ok) {
        throw toError(message);
      }
      if (!('response' in message)) {
        throw new Error('Server build worker returned no response');
      }
      const {
        status,
        statusText,
        headers,
        body: responseBody,
      } = message.response;
      return new Response(
        status === 204 || status === 304 || status === 101
          ? null
          : (responseBody as unknown as BodyInit),
        { status, statusText, headers }
      );
    },
    async close() {
      await worker.terminate();
    },
  };
};
