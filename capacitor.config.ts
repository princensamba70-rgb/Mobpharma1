import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.amipharma.gestion',
  appName: 'AMI PHARMA',
  webDir: 'frontend/dist',
  bundledWebRuntime: false,
  server: {
    // HTTPS is the production default. The debug-only Android manifest permits
    // cleartext traffic for the local emulator endpoint documented in README.
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      launchShowDuration: 0,
      backgroundColor: '#0b1324',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#ffffff',
      overlaysWebView: false,
    },
  },
};

export default config;
