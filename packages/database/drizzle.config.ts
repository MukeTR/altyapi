import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://altyapi:altyapi@localhost:5432/altyapi",
  },
  casing: "snake_case",
  strict: true,
});
