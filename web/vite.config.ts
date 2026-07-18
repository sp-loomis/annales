import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// The calendar + DSL engine lives in the backend package (../src/lib) and is
// pure, dependency-free TS. We import it directly so the web app compiles,
// lints, and previews definitions with the exact same code the server runs.
const sharedLibRoot = resolvePath(here, "../src/lib");

// Those sources use NodeNext-style explicit ".js" import specifiers that point
// at sibling ".ts" files. Vite/esbuild does not remap ".js"→".ts" on its own,
// so rewrite specifiers resolving under the shared lib. Web app code keeps its
// extensionless imports untouched.
function sharedLibJsToTs(): Plugin {
  return {
    name: "shared-lib-js-to-ts",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || !source.endsWith(".js")) return null;
      if (!importer.startsWith(sharedLibRoot)) return null;
      const candidate = resolvePath(dirname(importer), source).replace(/\.js$/, ".ts");
      if (existsSync(candidate)) {
        return this.resolve(candidate, importer, { ...options, skipSelf: true });
      }
      return null;
    },
  };
}

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [sharedLibJsToTs(), react()],
  resolve: {
    // Workspace hoisting can leave a second React copy at the repo root;
    // dedupe pins every import to one instance.
    dedupe: ["react", "react-dom"],
    alias: {
      "@calendar": resolvePath(sharedLibRoot, "calendar/index.ts"),
      "@dsl": resolvePath(sharedLibRoot, "dsl/index.ts"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
