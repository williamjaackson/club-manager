import { initializeDatabase } from "./database.js";

const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  throw new Error("Missing required environment variable: DATABASE_URL");
}

await initializeDatabase(connectionString);
console.log("Neon database schema is ready");
