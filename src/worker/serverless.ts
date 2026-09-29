import { getRequestListener } from "@hono/node-server";
import { app } from "./index";
import { createRuntimeEnv } from "./runtime-env";

const handler = getRequestListener((incomingRequest) => {
  const host =
    incomingRequest.headers.get("x-forwarded-host") ||
    incomingRequest.headers.get("host") ||
    "localhost";
  const proto = incomingRequest.headers.get("x-forwarded-proto") || "https";
  const requestUrl = new URL(incomingRequest.url ?? "/", `${proto}://${host}`);
  const rewrittenPath = requestUrl.searchParams.get("__api_path");
  requestUrl.searchParams.delete("__api_path");
  if (rewrittenPath !== null) requestUrl.pathname = `/api/${rewrittenPath}`;
  const headers = new Headers(incomingRequest.headers);
  const clientIp =
    incomingRequest.headers.get("x-vercel-forwarded-for") ??
    incomingRequest.headers.get("x-forwarded-for");
  headers.set("CF-Connecting-IP", clientIp?.split(",", 1)[0]?.trim() || "unknown");
  const init: RequestInit = {
    method: incomingRequest.method,
    headers,
    redirect: incomingRequest.redirect,
  };
  if (
    incomingRequest.method !== "GET" &&
    incomingRequest.method !== "HEAD" &&
    incomingRequest.body
  ) {
    Object.assign(init, { body: incomingRequest.body, duplex: "half" });
  }
  return createRuntimeEnv().then((env) => app.fetch(new Request(requestUrl, init), env));
});

export default handler;
