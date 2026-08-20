import { fileURLToPath } from "node:url";
import {
  DEFAULT_MAINTENANCE_SCHEDULE,
  MAINTENANCE_JOB_TITLE,
  maintenanceSummary,
  runMaintenance,
  validateMaintenanceSchedule,
} from "../server/maintenance";

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === "run") {
    const result = await runMaintenance();
    console.log(`Manutenzione completata: ${maintenanceSummary(result)}`);
    return;
  }

  if (command === "install") {
    const schedule = validateMaintenanceSchedule(
      process.argv[3] ?? DEFAULT_MAINTENANCE_SCHEDULE
    );

    const workerPath = fileURLToPath(new URL("../server/maintenance.ts", import.meta.url));
    await Bun.cron(workerPath, schedule, MAINTENANCE_JOB_TITLE);
    console.log(`Job ${MAINTENANCE_JOB_TITLE} installato con schedule ${schedule}`);
    return;
  }

  if (command === "remove") {
    await Bun.cron.remove(MAINTENANCE_JOB_TITLE);
    console.log(`Job ${MAINTENANCE_JOB_TITLE} rimosso`);
    return;
  }

  throw new TypeError("Uso: bun run cli/maintenance.ts <run|install [schedule]|remove>");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof TypeError ? error.message : "Operazione di manutenzione fallita");
  process.exitCode = 1;
}
