import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "poc/artifacts/**",
      "ios/.derived-data/**",
      "ios/TestResults/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        AbortSignal: "readonly",
      },
    },
  },
  {
    files: ["marketing/app-store/src/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        URLSearchParams: "readonly",
        window: "readonly",
      },
    },
  },
  {
    files: ["marketing/app-store/scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        document: "readonly",
        URL: "readonly",
      },
    },
  },
);
