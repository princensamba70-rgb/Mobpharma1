import type { CapacitorConfig } from '@capacitor/cli';

// The app accepts an explicitly configured HTTP API as well as HTTPS. Set this
// to false for an HTTPS-only production build. This does not disable TLS or
// certificate validation; it only permits WebView requests to an HTTP endpoint.
const allowHttpApi = process.env.CAPACITOR_ALLOW_HTTP_API !== 'false';

const config: CapacitorConfig = {
  appId: 'com.amipharma.gestion',
  appName: 'AMI PHARMA',
  webDir: 'frontend/dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
    cleartext: allowHttpApi,
  },
  android: {
    allowMixedContent: allowHttpApi,
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
