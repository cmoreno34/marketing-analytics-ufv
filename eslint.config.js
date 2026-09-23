/* A deliberately small config with one job: catch the mistakes that build
 * cleanly and then break in the browser.
 *
 * Vite does not resolve identifiers, so a component that reads `catCols` when
 * its prop is called `catSel` compiles, deploys, and blanks the page the first
 * time a student opens that tab. `no-undef` catches exactly that, which is why
 * the deploy workflow runs this before it builds.
 */
import globals from "globals";

export default [
  {
    files: ["src/**/*.{js,jsx}", "test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-unreachable": "error",
      "no-const-assign": "error",
      "no-self-compare": "error",
    },
  },
];
