// Flat ESLint config (ESLint 9). Two projects live in this repo with
// different rules — the Node server (src/**, NodeNext modules) and the
// browser client bundle (src/client/**, compiled standalone with no
// import/export) — so they get separate `languageOptions.project` entries
// pointing at their own tsconfig.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist/**", "public/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    ignores: ["src/client/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // No-op unused vars are usually a real mistake, but destructuring to
      // deliberately drop a field (see server.ts's `{ text: _t, ...r }`) is a
      // normal, intentional pattern here — allow a leading underscore to opt out.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/client/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.client.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The client bundle is deliberately NOT built as ES modules (see the
      // block comment atop types.ts): app.ts and types.ts compile together as
      // plain scripts sharing ambient globals, linked by a /// <reference>,
      // not an import. Both rules below are designed around module graphs, so
      // they can't see that link — types.ts's interfaces are used throughout
      // app.ts, and the reference IS the correct way to wire this up, not a
      // relic import style.
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
  // Must be last: turns off any stylistic rule Prettier would otherwise
  // fight with (so ESLint checks correctness, Prettier owns formatting).
  prettier
);
