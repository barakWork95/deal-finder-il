import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees: full checkouts of this repo living inside it, each with
    // its own .next build output. Linting them reports thousands of problems
    // that belong to generated files in a copy of the tree, and turns a red CI
    // run into something nobody reads. Flat config has no .eslintignore — this
    // array is the only thing ESLint 9 honours.
    ".claude/**",
  ]),
]);

export default eslintConfig;
