// @ts-check
import { defineConfig, envField } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

import node from "@astrojs/node";

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },
  output: "server",
  adapter: node({
    mode: "standalone",
  }),
  env: {
    schema: {
        S3_BUCKET: envField.string({ context: "server", access: "secret"}),
        S3_ACCESS_KEY: envField.string({ context: "server", access: "secret"}),
        S3_SECRET_KEY: envField.string({ context: "server", access: "secret"}),
        S3_REGION: envField.string({ context: "server", access: "secret"}),
        S3_ENDPOINT_URL: envField.string({ context: "server", access: "secret"}),
        DATABASE_URL: envField.string({ context: "server", access: "secret"})
    }
  }
});