import { db } from "./db/client";

const runMigration = async (filePath: string): Promise<boolean> => {
  try {
    await db.file(filePath);
    await db`INSERT INTO migrations (name) VALUES (${filePath.split("/").pop()})`;
    console.log(`Migration eseguita: ${filePath}`);
    return true;
  } catch (error) {
    console.error(`Errore migration ${filePath}:`, error);
    try {
      await db`ROLLBACK`;
    } catch {
      // Ignoriamo rollback su connessione non in transazione.
    }
    return false;
  }
};

const getAppliedMigrations = async (): Promise<Set<string>> => {
  try {
    const result = await db`SELECT name FROM migrations`;
    return new Set(result.map((row: { name: string }) => String(row.name)));
  } catch (error: unknown) {
    const maybePostgresError = error as { errno?: string };

    if (maybePostgresError?.errno === "42P01") {
      return new Set<string>();
    }

    throw error;
  }
};

const appliedMigrations = await getAppliedMigrations();

const glob = new Bun.Glob("*.sql");
const migrationFiles: string[] = [];

for await (const file of glob.scan("migrations")) {
  migrationFiles.push(file);
}

migrationFiles.sort((left, right) => left.localeCompare(right, "en"));

for (const file of migrationFiles) {
  if (appliedMigrations.has(file)) {
    console.log(`Migration gia applicata: ${file}`);
    continue;
  }

  const ok = await runMigration(`./migrations/${file}`);
  if (!ok) {
    throw new Error(`Migration fallita: ${file}`);
  }
}

console.log("Migrazioni completate.");
