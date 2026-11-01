import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds the Bot Flows Companion into ONE self-contained HTML document
// (`dist/index.html`, the manifest's `ui_entry`). A single input plus
// `inlineDynamicImports` lets `vite-plugin-singlefile` inline every script and
// stylesheet, including React Flow's base.css and the Tailwind utilities the
// @ryu/ui controls use, so the document makes no fetches under the Companion
// CSP. `scripts/sync-app-fixtures.sh bot-flows` vendors it into Core.
//
// The dev server is only for the local e2e harness (`e2e/`): it proxies the
// admin API to a locally started sidecar and maps the public `/bots` mount the
// way Core does, so the hosted chat page can be opened from the same origin.

const here = dirname(fileURLToPath(import.meta.url));
const sidecarPort = process.env.RYU_BOT_FLOWS_PORT ?? "19028";

export default defineConfig({
	root: here,
	base: "./",
	plugins: [react(), viteSingleFile()],
	build: {
		outDir: "dist",
		emptyOutDir: true,
		target: "esnext",
		cssCodeSplit: false,
		assetsInlineLimit: Number.POSITIVE_INFINITY,
		modulePreload: { polyfill: false },
		rollupOptions: {
			input: { "bot-flows": resolve(here, "index.html") },
			output: { inlineDynamicImports: true },
		},
	},
	optimizeDeps: { esbuildOptions: { target: "esnext" } },
	server: {
		host: "127.0.0.1",
		port: 19_028,
		strictPort: true,
		proxy: {
			"/api/bot-flows": { target: `http://127.0.0.1:${sidecarPort}` },
			"/bots": {
				target: `http://127.0.0.1:${sidecarPort}`,
				rewrite: (path) => path.replace(/^\/bots/, "/api/bot-flows"),
			},
		},
	},
});
