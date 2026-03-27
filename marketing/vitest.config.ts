import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
    setupFiles: [],
  },
  resolve: {
    alias: {
      "@/.velite": path.resolve(__dirname, ".velite/index.js"),
      "@": path.resolve(__dirname, "."),
    },
  },
});
