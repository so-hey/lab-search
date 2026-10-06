import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { optionalEnv, requiredEnv } from "../../config/env.js";

export function createSupabaseAdminClient(): SupabaseClient {
  const key =
    optionalEnv("SUPABASE_SECRET_KEY") ??
    optionalEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) {
    throw new Error(
      "SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) is required.",
    );
  }
  return createClient(requiredEnv("SUPABASE_URL"), key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
