import { sql } from "bun";

type SeedRole = "user" | "admin";

type SeedUser = {
  username: string;
  email: string;
  role: SeedRole;
  passwordHash: string;
};

const TOTAL_USERS = 50;
const ADMIN_USERNAME = "admin";
const ADMIN_EMAIL = "admin@bunsai.local";
const ADMIN_PASSWORD = "admin123!";
const USER_PASSWORD = "user123!";

function buildSeedUsers(
  totalUsers: number,
  adminPasswordHash: string,
  userPasswordHash: string
): SeedUser[] {
  const regularUsersCount = Math.max(0, totalUsers - 1);
  const users: SeedUser[] = [
    {
      username: ADMIN_USERNAME,
      email: ADMIN_EMAIL,
      role: "admin",
      passwordHash: adminPasswordHash,
    },
  ];

  for (let index = 1; index <= regularUsersCount; index += 1) {
    const suffix = String(index).padStart(3, "0");
    users.push({
      username: `user${suffix}`,
      email: `user${suffix}@example.com`,
      role: "user",
      passwordHash: userPasswordHash,
    });
  }

  return users;
}

async function upsertUser(user: SeedUser) {
  const now = new Date();

  await sql`
    INSERT INTO users ${sql({
      id: Bun.randomUUIDv7(),
      date_created: now,
      date_updated: now,
      email: user.email,
      password: user.passwordHash,
      username: user.username,
      role: user.role,
      is_active: true,
      activation_token: null,
      api_token: null,
    })}
    ON CONFLICT (username)
    DO UPDATE SET
      email = EXCLUDED.email,
      password = EXCLUDED.password,
      role = EXCLUDED.role,
      is_active = EXCLUDED.is_active,
      activation_token = EXCLUDED.activation_token,
      api_token = EXCLUDED.api_token,
      date_updated = EXCLUDED.date_updated
  `;
}

const run = async () => {
  const adminPasswordHash = await Bun.password.hash(ADMIN_PASSWORD);
  const userPasswordHash = await Bun.password.hash(USER_PASSWORD);
  const users = buildSeedUsers(TOTAL_USERS, adminPasswordHash, userPasswordHash);

  for (const user of users) {
    await upsertUser(user);
  }

  console.log(
    `Seed completato: ${users.length} utenti pronti (${users.length - 1} user + 1 admin).`
  );
  console.log(`Admin login -> username: ${ADMIN_USERNAME}, password: ${ADMIN_PASSWORD}`);
  console.log(`User login  -> username: user001, password: ${USER_PASSWORD}`);
};

if (import.meta.main) {
  await run();
}
