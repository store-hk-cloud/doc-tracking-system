import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default [
  { ignores: ['.open-next/**', '.wrangler/**', 'cloudflare-env.d.ts', 'desktop/web/**', 'desktop/full-web/**', 'build/desktop/**',
    'supabase/functions/desktop-api/**', 'supabase/functions/desktop-device-auth/**'] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "import/no-anonymous-default-export": "off",
      "react-hooks/set-state-in-effect": "off",
      "react/no-unescaped-entities": "off",
    },
  },
];
