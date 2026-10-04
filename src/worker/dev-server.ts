import { serve } from "@hono/node-server";
import { app } from "./index";
import { createRuntimeEnv } from "./runtime-env";
import { runReservationMaintenance } from "./domain";

const environment = createRuntimeEnv();
const server = serve({
  fetch: (request) => environment.then((env) => app.fetch(request, env)),
  hostname: "127.0.0.1",
  port: Number(process.env.API_PORT ?? 8787),
});

server.on("listening", () => {
  console.log(`IEEE INSAT SB API listening on http://127.0.0.1:${process.env.API_PORT ?? 8787}`);
});

let maintenanceBusy = false;
const maintenance = async () => {
  if (maintenanceBusy || process.env.NODE_ENV === "test") return;
  maintenanceBusy = true;
  try {
    await runReservationMaintenance(await environment);
  } catch {
    console.error("reservation_maintenance_failed");
  } finally {
    maintenanceBusy = false;
  }
};
const maintenanceTimer = setInterval(() => void maintenance(), 60_000);
maintenanceTimer.unref();
void maintenance();
const shutdown = () => {
  clearInterval(maintenanceTimer);
  server.close();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
