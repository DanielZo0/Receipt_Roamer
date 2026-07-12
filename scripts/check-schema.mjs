// Diffs the tables/columns the app expects (scripts/expected-schema.ts)
// against what's actually present in the live database, using a direct
// Postgres connection (DATABASE_URL). Catches the case where a migration
// file exists in supabase/migrations/ but was never applied.
//
// Usage: npm run db:check (requires DATABASE_URL in your environment/.env)
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
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env not present — fine, rely on already-set env vars
  }
}

async function loadExpectedSchema() {
  // Load the TS manifest without a build step: strip the type annotation and eval as JS.
  const modPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "expected-schema.ts",
  );
  const source = readFileSync(modPath, "utf-8");
  const jsSource = source
    .replace(/: \{ table: string; columns: string\[\] \}\[\]/, "")
    .replace(/export const/, "const");
  const wrapped = `${jsSource}\nreturn expectedSchema;`;
  // eslint-disable-next-line no-new-func
  return new Function(wrapped)();
}

async function main() {
  loadEnvFile();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Missing DATABASE_URL. Copy it from Supabase → Project Settings → Database → Connection string.");
    process.exit(1);
  }

  const expectedSchema = await loadExpectedSchema();

  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  let drift = false;

  try {
    for (const { table, columns } of expectedSchema) {
      const { rows: tableRows } = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );
      if (tableRows.length === 0) {
        drift = true;
        console.log(`✗ Table "${table}" is missing entirely.`);
        continue;
      }

      const { rows: columnRows } = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );
      const actualColumns = new Set(columnRows.map((r) => r.column_name));
      const missing = columns.filter((c) => !actualColumns.has(c));

      if (missing.length > 0) {
        drift = true;
        console.log(`✗ Table "${table}" is missing column(s): ${missing.join(", ")}`);
      } else {
        console.log(`✓ ${table}`);
      }
    }
  } finally {
    await client.end();
  }

  if (drift) {
    console.error("\nSchema drift detected — some migrations in supabase/migrations/ were not applied to this database.");
    process.exit(1);
  }

  console.log("\nNo schema drift detected.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
