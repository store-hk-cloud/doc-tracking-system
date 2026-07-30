import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.doctracking.app',
  appName: 'จดหมาย พัสดุ เอกสารภายใน',
  webDir: '.next',
  server: {
    url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    cleartext: true,
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
    },
  },
};

export default config;