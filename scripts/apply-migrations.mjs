// Applies one or more .sql files to the database in DATABASE_URL, inside a
// single transaction.
//
// The repo had no documented way to apply a migration, and the Supabase CLI is
// not linked here, so this exists to make applying one explicit and reversible.
//
//   npm run db:apply -- --dry-run supabase/migrations/2026...sql   <- rolls back
//   npm run db:apply --           supabase/migrations/2026...sql   <- commits
//
// --dry-run runs everything and then ROLLBACKs, so you find out whether the
// migration applies cleanly without keeping the result. Postgres DDL is
// transactional, so this is a genuine rehearsal, not an approximation.
//
// Files are applied in the order given. Any error rolls the whole batch back.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const { Client } = pg;

function loadEnvFile() {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
  try {
    const contents = readFileSync(envPath, "utf-8");
    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // No .env is fine as long as DATABASE_URL is already in the environment.
  }
}

async function main() {
  loadEnvFile();

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const files = args.filter((a) => !a.startsWith("--"));

  if (files.length === 0) {
    console.error("Usage: npm run db:apply -- [--dry-run] <file.sql> [more.sql ...]");
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "Missing DATABASE_URL. Supabase -> Project Settings -> Database -> Connection string.",
    );
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log(dryRun ? "DRY RUN - everything will be rolled back\n" : "APPLYING FOR REAL\n");

  try {
    await client.query("BEGIN");
    for (const file of files) {
      const sql = readFileSync(file, "utf-8");
      process.stdout.write(`  ${file} ... `);
      await client.query(sql);
      console.log("ok");
    }

    if (dryRun) {
      await client.query("ROLLBACK");
      console.log("\nAll files applied cleanly, then rolled back. Nothing was kept.");
    } else {
      await client.query("COMMIT");
      console.log("\nCommitted.");
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(
      `\nFAILED - everything rolled back, the database is unchanged.\n\n${err.message}`,
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
