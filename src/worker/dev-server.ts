import { serve } from "@hono/node-server";
import { app } from "./index";
import { createRuntimeEnv } from "./runtime-env";

const environment = createRuntimeEnv();
const server = serve({
  fetch: (request) => environment.then((env) => app.fetch(request, env)),
  hostname: "127.0.0.1",
  port: Number(process.env.API_PORT ?? 8787),
});

server.on("listening", () => {
  console.log("IEEE INSAT SB API listening on http://127.0.0.1:8787");
});

process.on("SIGINT", () => server.close());
process.on("SIGTERM", () => server.close());
