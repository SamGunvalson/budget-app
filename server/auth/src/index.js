import pg from "pg";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
if (!config.databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
// An idle client whose connection Postgres drops (restart, upgrade, network
// blip) emits 'error' on the pool. Unhandled, that event crashes the process
// and Nginx returns 502 until Docker restarts it. The pool already discards
// the broken client, so logging is enough; the next query opens a new one.
pool.on("error", (err) => {
  console.error("idle database client error:", err.message);
});
let app;
try {
  app = buildApp(config, { pool });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

let closing = false;
const shutdown = async (sig) => {
  if (closing) return;
  closing = true;
  app.log.info({ sig }, "shutting down");
  try {
    await app.close();
    await pool.end();
    process.exit(0);
  } catch {
    process.exit(1);
  }
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

await app.listen({ port: config.port, host: config.host });
