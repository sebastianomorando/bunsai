import User from "../entities/User";

const generateRandomPassword = (length = 16): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+";
  let password = "";

  for (let index = 0; index < length; index += 1) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return password;
};

const createUser = async (
  username: string,
  password?: string,
  email?: string
): Promise<void> => {
  const finalPassword = password || generateRandomPassword();
  const finalEmail = email || `${username}@example.com`;

  const user = await User.register({
    username,
    password: finalPassword,
    email: finalEmail,
  });

  console.log(`Utente creato: ${user.username}`);
  console.log(`Email: ${user.email}`);
  console.log(`Password: ${finalPassword}`);
};

const resetPassword = async (identifier: string): Promise<void> => {
  const user = await User.getByUsernameOrEmail(identifier);
  if (!user) {
    throw new Error("Utente non trovato");
  }

  const newPassword = generateRandomPassword();
  await user.updatePassword(newPassword);

  console.log(`Password aggiornata per ${user.username}`);
  console.log(`Nuova password: ${newPassword}`);
};

const command = process.argv[2];

if (command === "create") {
  const username = process.argv[3];
  const password = process.argv[4];
  const email = process.argv[5];

  if (!username) {
    console.error("Uso: bun run cli/user.ts create <username> [password] [email]");
    process.exit(1);
  }

  await createUser(username, password, email);
  process.exit(0);
}

if (command === "reset-password") {
  const identifier = process.argv[3];

  if (!identifier) {
    console.error("Uso: bun run cli/user.ts reset-password <username|email>");
    process.exit(1);
  }

  await resetPassword(identifier);
  process.exit(0);
}

console.error("Comando non valido. Comandi: create, reset-password");
process.exit(1);
