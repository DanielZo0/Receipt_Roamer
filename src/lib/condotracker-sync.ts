// Pulls condominiums/owners from CondoTracker's Postgres database (via a
// read-only role — see .env.example for CONDOTRACKER_DATABASE_URL) and
// upserts them into this app's own associations/owners tables, matched by
// condotracker_id. Rows linked to a condotracker_id that no longer exists
// upstream are deleted; rows created locally (condotracker_id IS NULL) are
// never touched. CondoTracker is the source of truth — this sync never
// writes back to it.
import pg from "pg";

const { Client } = pg;

export interface SyncSummary {
  associations: { created: number; updated: number; deleted: number };
  owners: { created: number; updated: number; deleted: number };
}

export async function syncFromCondoTracker(): Promise<SyncSummary> {
  const condoTrackerUrl = process.env.CONDOTRACKER_DATABASE_URL;
  const receiptRoamerUrl = process.env.DATABASE_URL;

  if (!condoTrackerUrl) {
    throw new Error("Missing CONDOTRACKER_DATABASE_URL environment variable.");
  }
  if (!receiptRoamerUrl) {
    throw new Error("Missing DATABASE_URL environment variable.");
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

  try {
    const { rows: condos } = await source.query<{
      id: string;
      name: string;
      address: string | null;
    }>(`SELECT id, name, address FROM condominiums`);

    const { rows: owners } = await source.query<{
      id: string;
      condominium_id: string | null;
      name: string;
      apartment: string | null;
      email: string | null;
      phone: string | null;
      id_number: string | null;
      vat_number: string | null;
      yearly_contribution: string | null;
      contribution_paid: boolean;
      notes: string | null;
    }>(
      `SELECT id, condominium_id, name, apartment, email, phone,
              id_number, vat_number, yearly_contribution,
              contribution_paid, notes
       FROM owners`,
    );

    const summary: SyncSummary = {
      associations: { created: 0, updated: 0, deleted: 0 },
      owners: { created: 0, updated: 0, deleted: 0 },
    };

    await dest.query("BEGIN");

    const condoIdMap = new Map<string, string>();
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

    const ownerCondotrackerIds: string[] = [];
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

    // Delete stale owners first (associations.id is referenced by owners.condominium_id).
    const { rowCount: ownersDeleted } = await dest.query(
      ownerCondotrackerIds.length > 0
        ? `DELETE FROM public.owners WHERE condotracker_id IS NOT NULL AND condotracker_id != ALL($1::text[])`
        : `DELETE FROM public.owners WHERE condotracker_id IS NOT NULL`,
      ownerCondotrackerIds.length > 0 ? [ownerCondotrackerIds] : [],
    );
    summary.owners.deleted = ownersDeleted ?? 0;

    const condoIds = condos.map((c) => c.id);
    const { rowCount: assocDeleted } = await dest.query(
      condoIds.length > 0
        ? `DELETE FROM public.associations WHERE condotracker_id IS NOT NULL AND condotracker_id != ALL($1::text[])`
        : `DELETE FROM public.associations WHERE condotracker_id IS NOT NULL`,
      condoIds.length > 0 ? [condoIds] : [],
    );
    summary.associations.deleted = assocDeleted ?? 0;

    await dest.query("COMMIT");
    return summary;
  } catch (e) {
    await dest.query("ROLLBACK");
    throw e;
  } finally {
    await source.end();
    await dest.end();
  }
}
