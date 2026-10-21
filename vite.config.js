import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    sourcemap: false,
    cssCodeSplit: false,
    target: "es2022",
    chunkSizeWarningLimit: 2500,
    rolldownOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
});
