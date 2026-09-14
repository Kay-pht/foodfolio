import { URL } from "node:url";

const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export const RECOVER_STALE_LOCAL_ANALYSES_SQL = `
WITH recovered AS (
  UPDATE "Recipe"
  SET
    "analysisStatus" = 'failed',
    "title" = '解析に失敗したレシピ',
    "processingRunId" = NULL,
    "processingLeaseExpiresAt" = NULL,
    "updatedAt" = clock_timestamp()
  WHERE
    "analysisStatus" = 'processing'
    AND "processingLeaseExpiresAt" <= clock_timestamp()
  RETURNING 1
)
SELECT count(*) FROM recovered;
`;

export function mergeLocalEnvironment(...environmentLayers) {
  return Object.assign({}, ...environmentLayers);
}

export function assertLocalDatabase(name, value) {
  let databaseUrl;
  try {
    databaseUrl = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL`);
  }

  const hostname = databaseUrl.hostname.replace(/^\[|\]$/g, "");
  const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
  const username = decodeURIComponent(databaseUrl.username);
  const port = databaseUrl.port || "5432";
  const valid =
    ["postgres:", "postgresql:"].includes(databaseUrl.protocol) &&
    LOCAL_DATABASE_HOSTS.has(hostname) &&
    port === "5432" &&
    databaseName === "foodfolio" &&
    username === "foodfolio";

  if (!valid) {
    throw new Error(
      `${name} must use the foodfolio user and database on localhost:5432`,
    );
  }
}
