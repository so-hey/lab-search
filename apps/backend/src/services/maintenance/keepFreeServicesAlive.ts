export type KeepAliveFetch = typeof fetch;

export type KeepFreeServicesAliveOptions = {
  supabaseUrl: string;
  supabaseSecretKey: string;
  zillizEndpoint: string;
  zillizToken: string;
  zillizCollection: string;
  request?: KeepAliveFetch;
};

export type KeepFreeServicesAliveResult = {
  supabaseQueries: number;
  zillizEntities: number;
  zillizCost?: number;
};

const SUPABASE_TABLES = ["documents", "allowed_users", "search_logs"] as const;

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function supabaseHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: apiKey };
  // 新形式のsb_secret keyはJWTではないためBearerへ設定しない。
  if (!apiKey.startsWith("sb_")) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

async function responseDetails(response: Response): Promise<string> {
  const body = (await response.text()).trim();
  return body ? `: ${body.slice(0, 1_000)}` : "";
}

export async function keepFreeServicesAlive(
  options: KeepFreeServicesAliveOptions,
): Promise<KeepFreeServicesAliveResult> {
  const request = options.request ?? fetch;
  const supabaseUrl = withoutTrailingSlash(options.supabaseUrl);
  const zillizEndpoint = withoutTrailingSlash(options.zillizEndpoint);

  for (const table of SUPABASE_TABLES) {
    const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
    url.searchParams.set("select", "id");
    url.searchParams.set("limit", "1");
    const response = await request(url, {
      headers: supabaseHeaders(options.supabaseSecretKey),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(
        `Supabase keep-alive failed for ${table} (${response.status})${await responseDetails(response)}`,
      );
    }
  }

  const zillizResponse = await request(
    `${zillizEndpoint}/v2/vectordb/entities/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.zillizToken}`,
        "Content-Type": "application/json",
        "Request-Timeout": "5",
      },
      body: JSON.stringify({
        collectionName: options.zillizCollection,
        outputFields: ["id"],
        limit: 1,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!zillizResponse.ok) {
    throw new Error(
      `Zilliz keep-alive failed (${zillizResponse.status})${await responseDetails(zillizResponse)}`,
    );
  }

  const zillizBody = (await zillizResponse.json()) as {
    code?: number;
    cost?: number;
    data?: unknown[];
    message?: string;
  };
  if (zillizBody.code !== 0) {
    throw new Error(
      `Zilliz keep-alive failed (code ${String(zillizBody.code)}): ${zillizBody.message ?? "unknown error"}`,
    );
  }

  return {
    supabaseQueries: SUPABASE_TABLES.length,
    zillizEntities: Array.isArray(zillizBody.data) ? zillizBody.data.length : 0,
    ...(typeof zillizBody.cost === "number" ? { zillizCost: zillizBody.cost } : {}),
  };
}
