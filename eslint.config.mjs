import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

export default [
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        Hls: "readonly"
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off",
    },
  },
  eslintConfigPrettier,
];
