import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript sources and are bundled into the service artifact.
  noExternal: [/^@altyapi\//],
});
