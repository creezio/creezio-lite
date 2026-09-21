import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: ["./db/schema.ts", "./app/modules/*/db-schema.ts"],
  dialect: "sqlite",
});
