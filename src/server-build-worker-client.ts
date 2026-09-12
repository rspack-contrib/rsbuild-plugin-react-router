import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type {
  ServerBuildDescription,
  ServerBuildWorkerData,
  ServerBuildWorkerRequest,
  ServerBuildWorkerResponse,
} from './server-build-worker-protocol.js';

const defaultWorkerPath = fileURLToPath(
  new URL('./server-build-worker.js', import.meta.url)
);

export type ServerBuildWorker = {
  /** Plain-data view of the classic server build (routes, assets, prerender). */
  description: ServerBuildDescription | undefined;
  /** Runs the request against the server build in the worker. */
  handler(request: Request): Promise<Response>;
  /** Terminates the worker, and with it any handle the server graph opened. */
  close(): Promise<void>;
};

type Reply = Extract<ServerBuildWorkerResponse, { type: 'reply' }>;

type Pending = {
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
};

const headerEntries = (headers: Headers): [string, string][] => {
  const entries: [string, string][] = [];
  headers.forEach((value, key) => entries.push([key, value]));
  return entries;
};

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const replyError = (reply: Extract<Reply, { ok: false }>): Error => {
  const error = new Error(reply.error.message);
  error.name = reply.error.name ?? error.name;
  if (reply.error.stack) {
    error.stack = reply.error.stack;
  }
  return error;
};

/**
 * Evaluate a built server bundle in a worker thread and proxy requests to it.
 * Build-time rendering used to `import()` the bundle into the build process;
 * a module-scope handle in the app's server graph then kept `rsbuild build`
 * alive forever (#135). The worker is terminated by `close()`.
 *
 * The worker's `exit` is its final event, so any exit (including one between
 * requests, e.g. the app calling `process.exit`) is terminal: outstanding and
 * later requests reject instead of waiting for a reply that cannot come.
 */
export const startServerBuildWorker = async (
  data: ServerBuildWorkerData,
  // Tests run from `src/` and point this at the built worker.
  workerPath: string = defaultWorkerPath
): Promise<ServerBuildWorker> => {
  const worker = new Worker(workerPath, { workerData: data });
  const pending = new Map<number, Pending>();
  let nextId = 0;
  let failure: Error | undefined;

  const fail = (error: Error): void => {
    failure ??= error;
    for (const { reject } of pending.values()) {
      reject(failure);
    }
    pending.clear();
  };

  const ready = new Promise<ServerBuildDescription | undefined>(
    (resolve, reject) => {
      worker.on('message', (message: ServerBuildWorkerResponse) => {
        if (message.type === 'ready') {
          resolve(message.description);
          return;
        }
        const entry = pending.get(message.id);
        pending.delete(message.id);
        entry?.resolve(message);
      });
      worker.on('error', error => {
        fail(toError(error));
        reject(failure);
      });
      worker.on('exit', code => {
        fail(new Error(`Server build worker exited with code ${code}`));
        reject(failure);
      });
    }
  );

  const send = (
    request: ServerBuildWorkerRequest,
    transfer: ArrayBuffer[] = []
  ): void => {
    worker.postMessage(request, transfer);
  };

  // Import errors surface as worker 'error' events, an early exit as 'exit'.
  const description = await ready;

  return {
    description,
    async handler(request) {
      if (failure) {
        throw failure;
      }
      const id = nextId++;
      const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
      const body = hasBody
        ? new Uint8Array(await request.arrayBuffer())
        : undefined;
      // Relay the parent's release so the worker-side Request aborts too.
      const onAbort = (): void => {
        if (pending.has(id)) {
          send({ type: 'abort', id });
        }
      };
      request.signal.addEventListener('abort', onAbort, { once: true });
      const reply = await new Promise<Reply>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send(
          {
            type: 'request',
            id,
            url: request.url,
            method: request.method,
            headers: headerEntries(request.headers),
            body,
          },
          body ? [body.buffer as ArrayBuffer] : []
        );
      }).finally(() => request.signal.removeEventListener('abort', onAbort));
      if (!reply.ok) {
        throw replyError(reply);
      }
      const {
        status,
        statusText,
        headers,
        body: responseBody,
      } = reply.response;
      return new Response(
        status === 204 || status === 304 || status === 101
          ? null
          : (responseBody as unknown as BodyInit),
        { status, statusText, headers }
      );
    },
    async close() {
      fail(new Error('Server build worker was closed'));
      await worker.terminate();
    },
  };
};
