import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { syncFromCondoTracker } from "@/lib/condotracker-sync";

const COOKIE_NAME = "receipt_roamer_auth_session";

export const runCondoTrackerSync = createServerFn({ method: "POST" }).handler(async () => {
  if (getCookie(COOKIE_NAME) !== "true") {
    throw new Error("Not authenticated");
  }

  try {
    return await syncFromCondoTracker();
  } catch (e) {
    console.error("CondoTracker sync failed", e);
    throw new Error(`CondoTracker sync failed: ${(e as Error).message}`);
  }
});
