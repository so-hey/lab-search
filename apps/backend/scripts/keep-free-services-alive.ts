import { optionalEnv, requiredEnv } from "../src/config/env.js";
import { keepFreeServicesAlive } from "../src/services/maintenance/keepFreeServicesAlive.js";

async function main(): Promise<void> {
  const supabaseSecretKey =
    optionalEnv("SUPABASE_SECRET_KEY") ?? requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const result = await keepFreeServicesAlive({
    supabaseUrl: requiredEnv("SUPABASE_URL"),
    supabaseSecretKey,
    zillizEndpoint: requiredEnv("ZILLIZ_ENDPOINT"),
    zillizToken: requiredEnv("ZILLIZ_TOKEN"),
    zillizCollection: requiredEnv("ZILLIZ_COLLECTION"),
  });

  console.log(`[keepalive] Supabase queries: ${result.supabaseQueries}/3`);
  console.log(
    `[keepalive] Zilliz entities: ${result.zillizEntities}, cost: ${result.zillizCost ?? "not reported"}`,
  );
}

main().catch((error: unknown) => {
  console.error("[keepalive] failed", error);
  process.exitCode = 1;
});
