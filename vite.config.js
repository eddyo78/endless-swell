import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    sourcemap: false,
    cssCodeSplit: false,
    target: "es2022",
    chunkSizeWarningLimit: 8000,
    rolldownOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
});
