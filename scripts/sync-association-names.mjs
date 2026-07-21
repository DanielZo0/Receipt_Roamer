// Renames public.associations rows to match condominiums_export.json.
//
// The export's own "id" values do not correspond to the live DB's association
// ids (they were regenerated on a later reseed), so entries are matched by
// current name instead — using an explicit mapping for the handful of
// entries where names diverge (typos, abbreviations, added/dropped
// qualifiers) plus exact/trimmed matching for everything else.
//
// Usage: npm run sync:association-names (requires DATABASE_URL in your environment/.env)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const { Client } = pg;

// Maps a current DB name to the export name it should become, for cases
// where simple trimmed-name matching wouldn't find the pair.
const CURRENT_NAME_TO_EXPORT_NAME = {
  "134 Vistafior": "134, Vistafior Attard",
  "Dhalia": "Dahlia",
  "Dragonara Vista": "Dragonara",
  "Paolo Court": "Poalo Court, Ta' Xbiex",
  "Vista Apartments Block C": "Vista Apartments",
  "SPBA": "St Peter's Court Block A",
  "SPBB": "St. Peter's Court Block B",
  "St. Anthony Block B": "St. Anthony Block B Rabat",
  "St. Anthony Block D": "St Anthony Block D Rabat",
};

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

async function main() {
  loadEnvFile();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Missing DATABASE_URL. Copy it from Supabase → Project Settings → Database → Connection string.");
    process.exit(1);
  }

  const exportPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "condominiums_export.json",
  );
  const entries = JSON.parse(readFileSync(exportPath, "utf-8"));
  const exportNames = new Set(entries.map((e) => e.name.trim()));

  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  let updated = 0;
  let unchanged = 0;
  let unresolved = 0;

  try {
    const { rows: associations } = await client.query("SELECT id, name FROM associations");

    for (const { id, name } of associations) {
      const targetName = CURRENT_NAME_TO_EXPORT_NAME[name] ?? (exportNames.has(name) ? name : undefined);

      if (targetName === undefined) {
        // Not in the export at all (e.g. "Home") — leave untouched.
        continue;
      }

      if (targetName === name) {
        unchanged += 1;
        continue;
      }

      await client.query("UPDATE associations SET name = $1 WHERE id = $2", [targetName, id]);
      console.log(`✓ updated ${id}: "${name}" -> "${targetName}"`);
      updated += 1;
    }

    // Sanity check: every export name should now be present in the DB exactly once.
    const { rows: finalRows } = await client.query("SELECT name FROM associations");
    const finalNames = new Set(finalRows.map((r) => r.name));
    for (const exportName of exportNames) {
      if (!finalNames.has(exportName)) {
        console.log(`✗ unresolved: export name "${exportName}" has no matching association after sync`);
        unresolved += 1;
      }
    }
  } finally {
    await client.end();
  }

  console.log(`\nUpdated: ${updated}, unchanged: ${unchanged}, unresolved: ${unresolved}`);
  if (unresolved > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
