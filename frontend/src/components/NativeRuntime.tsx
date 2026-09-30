import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useNavigate } from 'react-router-dom';

/** Native-only lifecycle integration: splash screen, status bar and Android back. */
export default function NativeRuntime() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;

    StatusBar.setStyle({ style: Style.Light }).catch(() => {});
    StatusBar.setBackgroundColor({ color: '#ffffff' }).catch(() => {});
    const hideSplash = window.setTimeout(() => SplashScreen.hide().catch(() => {}), 450);

    const backListener = App.addListener('backButton', ({ canGoBack }) => {
      // React Router history is the mobile navigation stack for the web UI.
      if (canGoBack || window.history.length > 1) navigate(-1);
      else App.exitApp().catch(() => {});
    });

    return () => {
      window.clearTimeout(hideSplash);
      backListener.then((handle) => handle.remove()).catch(() => {});
    };
  }, [navigate]);

  return null;
}
