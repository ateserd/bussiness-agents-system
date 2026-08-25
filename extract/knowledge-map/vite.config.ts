import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // `open: true` is handy on a desktop but throws on headless Linux (no
  // xdg-open); add it back locally if you want the browser to launch itself.
  server: { port: 5180 },
});
