import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { Pool } from "pg";

export interface PostgresTestContext {
  container: StartedPostgreSqlContainer;
  prisma: PrismaClient;
}

export async function startPostgres(): Promise<PostgresTestContext> {
  const container = await new PostgreSqlContainer("postgres:18-alpine")
    .withDatabase("foodfolio")
    .withUsername("foodfolio")
    .withPassword("foodfolio")
    .start();
  const databaseUrl = container.getConnectionUri();
  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_DIRECT_URL = databaseUrl;
  const migrationPath = fileURLToPath(
    new URL(
      "../../prisma/migrations/20260827120000_initial/migration.sql",
      import.meta.url,
    ),
  );
  const pool = new Pool({ connectionString: databaseUrl });
  await pool.query(await readFile(migrationPath, "utf8"));
  await pool.end();
  return {
    container,
    prisma: new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    }),
  };
}

export async function stopPostgres(
  context: PostgresTestContext,
): Promise<void> {
  await context.prisma.$disconnect();
  await context.container.stop();
}
