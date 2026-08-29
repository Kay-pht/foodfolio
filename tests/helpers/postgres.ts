import { readdir, readFile } from "node:fs/promises";
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

async function applyMigrations(databaseUrl: string): Promise<void> {
  const migrationsRoot = fileURLToPath(
    new URL("../../prisma/migrations/", import.meta.url),
  );
  const migrationDirectories = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    for (const directory of migrationDirectories) {
      const migrationPath = fileURLToPath(
        new URL(
          `../../prisma/migrations/${directory}/migration.sql`,
          import.meta.url,
        ),
      );
      await pool.query(await readFile(migrationPath, "utf8"));
    }
  } finally {
    await pool.end();
  }
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
  await applyMigrations(databaseUrl);
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
