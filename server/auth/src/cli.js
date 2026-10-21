import pg from "pg";
import bcrypt from "bcryptjs";
import { loadConfig } from "./config.js";

const usage = "Usage: cli <reset-password|create-user> <email> [--password X]  (password read from stdin if omitted)";

async function readStdin() {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data.replace(/\r?\n$/, "");
}

async function main() {
  const [cmd, emailArg, ...rest] = process.argv.slice(2);
  if (!["reset-password", "create-user"].includes(cmd) || !emailArg) {
    console.error(usage);
    return 2;
  }
  const config = loadConfig();
  if (!config.databaseUrl) {
    console.error("DATABASE_URL is required");
    return 1;
  }
  const email = emailArg.trim().toLowerCase();
  const i = rest.indexOf("--password");
  let password = i >= 0 ? rest[i + 1] : undefined;
  if (i >= 0 && password === undefined) {
    console.error(usage);
    return 2;
  }
  if (password === undefined) password = await readStdin();
  if (password.length < config.passwordMinLength || Buffer.byteLength(password) > 72) {
    console.error(`Password must be ${config.passwordMinLength}-72 bytes`);
    return 1;
  }
  const hash = await bcrypt.hash(password, config.bcryptCost);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
  try {
    if (cmd === "create-user") {
      await pool.query("INSERT INTO auth.users (email, encrypted_password) VALUES ($1, $2)", [email, hash]);
      console.log(`Created user ${email}`);
    } else {
      const r = await pool.query(
        "UPDATE auth.users SET encrypted_password = $1, updated_at = now() WHERE email = $2 RETURNING id",
        [hash, email],
      );
      if (!r.rows[0]) {
        console.error("User not found");
        return 1;
      }
      await pool.query("UPDATE auth.refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [
        r.rows[0].id,
      ]);
      console.log(`Password reset for ${email}; all sessions revoked`);
    }
    return 0;
  } catch (e) {
    console.error(e.code === "23505" ? "User already exists" : e.message);
    return 1;
  } finally {
    await pool.end();
  }
}

process.exitCode = await main();
