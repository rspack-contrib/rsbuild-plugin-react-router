import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import { startServerBuildWorker } from '../src/server-build-worker-client';

// Real worker threads against the built worker entry: the protocol has two
// sides, and parent-only mocks cannot see whether the Request the app receives
// is aborted or whether an idle worker exit is remembered.
// Missing (run `pnpm build`) surfaces as the Worker's own module-not-found.
const builtWorkerPath = resolve(__dirname, '../dist/server-build-worker.js');

// An RSC-shaped server build (`export default { fetch }`) is the smallest
// bundle the worker accepts; its routes exercise one lifecycle case each.
const serverBuildSource = `
import { appendFileSync } from "node:fs";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/abort-log":
        request.signal.addEventListener("abort", () => {
          appendFileSync(url.searchParams.get("file"), "aborted\\n");
        });
        return new Response("logged");
      case "/wait-for-abort":
        await new Promise(resolve =>
          request.signal.addEventListener("abort", resolve, { once: true })
        );
        return new Response("released", { status: 499 });
      case "/exit-soon":
        setTimeout(() => process.exit(0), 20);
        return new Response("bye");
      case "/throw":
        throw new TypeError("boom");
      default:
        return new Response("hello " + url.pathname, {
          status: 201,
          headers: { "x-echo": request.headers.get("x-in") ?? "" },
        });
    }
  },
};
`;

const settle = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('server build worker', () => {
  let directory: string;
  let workers: Array<{ close(): Promise<void> }> = [];

  const start = async () => {
    const serverBuildPath = resolve(directory, 'server.mjs');
    await writeFile(serverBuildPath, serverBuildSource);
    const worker = await startServerBuildWorker(
      { serverBuildPath, mode: 'rsc' },
      builtWorkerPath
    );
    workers.push(worker);
    return worker;
  };

  beforeEach(async () => {
    directory = await mkdtemp(resolve(tmpdir(), 'rsbuild-rr-worker-'));
  });

  afterEach(async () => {
    await Promise.all(workers.map(worker => worker.close()));
    workers = [];
    await rm(directory, { recursive: true, force: true });
  });

  it('proxies status, headers and body both ways', async () => {
    const worker = await start();
    const response = await worker.handler(
      new Request('http://localhost/greet', { headers: { 'x-in': 'ping' } })
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('x-echo')).toBe('ping');
    expect(await response.text()).toBe('hello /greet');
  });

  it("aborts the app's Request once its response has been consumed", async () => {
    const worker = await start();
    const log = resolve(directory, 'abort.log');
    const response = await worker.handler(
      new Request(`http://localhost/abort-log?file=${encodeURIComponent(log)}`)
    );
    expect(await response.text()).toBe('logged');
    // The worker releases the request before replying, so the app's cleanup
    // has already run by the time the parent sees the response.
    expect(readFileSync(log, 'utf8')).toBe('aborted\n');
  });

  it("relays the parent's abort to an in-flight request", async () => {
    const worker = await start();
    const controller = new AbortController();
    const pending = worker.handler(
      new Request('http://localhost/wait-for-abort', {
        signal: controller.signal,
      })
    );
    await settle(50);
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(499);
    expect(await response.text()).toBe('released');
  });

  it('rethrows app errors with their message and name', async () => {
    const worker = await start();
    await expect(
      worker.handler(new Request('http://localhost/throw'))
    ).rejects.toMatchObject({ name: 'TypeError', message: 'boom' });
  });

  it('rejects requests sent after the worker exited while idle', async () => {
    const worker = await start();
    const response = await worker.handler(
      new Request('http://localhost/exit-soon')
    );
    expect(await response.text()).toBe('bye');
    // Nothing is pending when the worker exits; the exit must still be final.
    await settle(300);
    await expect(
      worker.handler(new Request('http://localhost/after'))
    ).rejects.toThrow('Server build worker exited with code 0');
    await expect(
      worker.handler(new Request('http://localhost/again'))
    ).rejects.toThrow('Server build worker exited with code 0');
  });

  it('rejects requests after close()', async () => {
    const worker = await start();
    await worker.close();
    await expect(
      worker.handler(new Request('http://localhost/after-close'))
    ).rejects.toThrow('Server build worker was closed');
  });

  it('fails to start when the bundle cannot be imported', async () => {
    await expect(
      startServerBuildWorker(
        { serverBuildPath: resolve(directory, 'missing.mjs'), mode: 'rsc' },
        builtWorkerPath
      )
    ).rejects.toThrow(/Cannot find module|ERR_MODULE_NOT_FOUND/);
  });
});
