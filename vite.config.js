import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base must match the repo name: GitHub Pages serves this at
// cmoreno34.github.io/marketing-analytics-ufv/ and assets 404 without it.
export default defineConfig({
  plugins: [react()],
  base: "/marketing-analytics-ufv/",
});
