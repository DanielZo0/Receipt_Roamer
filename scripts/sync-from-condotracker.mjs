// Pulls condominiums/owners from CondoTracker's Postgres database (read-only
// role) and upserts them into this app's associations/owners tables, matched
// by condotracker_id. Deletes rows whose condotracker_id no longer exists
// upstream; never touches locally-created rows (condotracker_id IS NULL) or
// writes back to CondoTracker.
//
// Usage: npm run sync:condotracker
// Requires CONDOTRACKER_DATABASE_URL (read-only role) and DATABASE_URL
// (this app's own database) in your environment/.env.
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

async function main() {
  loadEnvFile();

  const condoTrackerUrl = process.env.CONDOTRACKER_DATABASE_URL;
  const receiptRoamerUrl = process.env.DATABASE_URL;

  if (!condoTrackerUrl) {
    console.error(
      "Missing CONDOTRACKER_DATABASE_URL. See .env.example for the read-only connection string format.",
    );
    process.exit(1);
  }
  if (!receiptRoamerUrl) {
    console.error(
      "Missing DATABASE_URL. Copy it from Supabase → Project Settings → Database → Connection string.",
    );
    process.exit(1);
  }

  const source = new Client({
    connectionString: condoTrackerUrl,
    ssl: { rejectUnauthorized: false },
  });
  const dest = new Client({
    connectionString: receiptRoamerUrl,
    ssl: { rejectUnauthorized: false },
  });

  await source.connect();
  await dest.connect();

  const summary = {
    associations: { created: 0, updated: 0, deleted: 0 },
    owners: { created: 0, updated: 0, deleted: 0 },
  };

  try {
    const { rows: condos } = await source.query(`SELECT id, name, address FROM condominiums`);
    const { rows: owners } = await source.query(
      `SELECT id, "condominiumId" AS condominium_id, name, apartment, email, phone,
              "idNumber" AS id_number, "vatNumber" AS vat_number,
              "yearlyContribution" AS yearly_contribution,
              "contributionPaid" AS contribution_paid, notes
       FROM owners`,
    );

    await dest.query("BEGIN");

    const condoIdMap = new Map();
    for (const c of condos) {
      const { rows } = await dest.query(
        `INSERT INTO public.associations (name, address, condotracker_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (condotracker_id) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address
         RETURNING id, (xmax = 0) AS inserted`,
        [c.name, c.address, c.id],
      );
      condoIdMap.set(c.id, rows[0].id);
      if (rows[0].inserted) summary.associations.created += 1;
      else summary.associations.updated += 1;
    }

    const ownerCondotrackerIds = [];
    for (const o of owners) {
      const condominiumId = o.condominium_id ? (condoIdMap.get(o.condominium_id) ?? null) : null;
      const { rows } = await dest.query(
        `INSERT INTO public.owners
           (condominium_id, name, apartment, email, phone, id_number, vat_number,
            yearly_contribution, contribution_paid, notes, condotracker_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (condotracker_id) DO UPDATE SET
           condominium_id = EXCLUDED.condominium_id,
           name = EXCLUDED.name,
           apartment = EXCLUDED.apartment,
           email = EXCLUDED.email,
           phone = EXCLUDED.phone,
           id_number = EXCLUDED.id_number,
           vat_number = EXCLUDED.vat_number,
           yearly_contribution = EXCLUDED.yearly_contribution,
           contribution_paid = EXCLUDED.contribution_paid,
           notes = EXCLUDED.notes
         RETURNING id, (xmax = 0) AS inserted`,
        [
          condominiumId,
          o.name,
          o.apartment,
          o.email,
          o.phone,
          o.id_number,
          o.vat_number,
          o.yearly_contribution,
          o.contribution_paid,
          o.notes,
          o.id,
        ],
      );
      ownerCondotrackerIds.push(o.id);
      if (rows[0].inserted) summary.owners.created += 1;
      else summary.owners.updated += 1;
    }

    const { rowCount: ownersDeleted } = await dest.query(
      ownerCondotrackerIds.length > 0
        ? `DELETE FROM public.owners WHERE condotracker_id IS NOT NULL AND condotracker_id != ALL($1::uuid[])`
        : `DELETE FROM public.owners WHERE condotracker_id IS NOT NULL`,
      ownerCondotrackerIds.length > 0 ? [ownerCondotrackerIds] : [],
    );
    summary.owners.deleted = ownersDeleted ?? 0;

    const condoIds = condos.map((c) => c.id);
    const { rowCount: assocDeleted } = await dest.query(
      condoIds.length > 0
        ? `DELETE FROM public.associations WHERE condotracker_id IS NOT NULL AND condotracker_id != ALL($1::uuid[])`
        : `DELETE FROM public.associations WHERE condotracker_id IS NOT NULL`,
      condoIds.length > 0 ? [condoIds] : [],
    );
    summary.associations.deleted = assocDeleted ?? 0;

    await dest.query("COMMIT");
  } catch (err) {
    await dest.query("ROLLBACK");
    throw err;
  } finally {
    await source.end();
    await dest.end();
  }

  console.log("Associations:", summary.associations);
  console.log("Owners:", summary.owners);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
