import type { Page } from "@playwright/test";

export type ObservedAssetResponses = {
  /** Script/stylesheet request URLs, in request order. */
  requests: string[];
  /** Final response per script/stylesheet URL. */
  responses: Map<string, { status: number; contentType: string }>;
  /** HTTP >= 400 responses and network-level request failures. */
  failures: string[];
  pageErrors: Error[];
};

const ASSET_URL = /\.(?:m?js|css)(?:\?|$)/;

// Records what the browser actually fetched for scripts and stylesheets, so
// regression tests assert on real runtime requests instead of replaying HTTP.
export const observeAssetResponses = (page: Page): ObservedAssetResponses => {
  const observed: ObservedAssetResponses = {
    requests: [],
    responses: new Map(),
    failures: [],
    pageErrors: [],
  };
  page.on("request", (request) => {
    if (ASSET_URL.test(request.url())) observed.requests.push(request.url());
  });
  page.on("requestfailed", (request) => {
    observed.failures.push(`${request.failure()?.errorText ?? "failed"} ${request.url()}`);
  });
  page.on("response", (response) => {
    if (ASSET_URL.test(response.url())) {
      observed.responses.set(response.url(), {
        status: response.status(),
        contentType: response.headers()["content-type"] ?? "",
      });
    }
    if (response.status() >= 400) {
      observed.failures.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("pageerror", (error) => observed.pageErrors.push(error));
  return observed;
};
