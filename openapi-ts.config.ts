import { defineConfig } from "@hey-api/openapi-ts";

// Generates a fully-typed TS client from the FastAPI OpenAPI schema.
// Pipeline (root `pnpm codegen`):
//   1. codegen:schema — FastAPI exports its OpenAPI to packages/api-client/openapi.json
//   2. codegen:client — this config emits the typed client into src/generated/
//
// The hand-written wrapper in packages/api-client/src/index.ts re-exports from
// generated/ and adds auth/credentialed-fetch helpers, so app code imports a
// single, stable surface ("@byos/api-client").
export default defineConfig({
  input: "./packages/api-client/openapi.json",
  output: {
    path: "./packages/api-client/src/generated",
    format: "prettier",
  },
  plugins: ["@hey-api/client-fetch"],
});
