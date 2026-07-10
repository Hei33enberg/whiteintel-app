// WhiteIntel mobile shell — Capacitor 6 config.
//
// v0.1 strategy: ship a native Android/iOS app that loads the LIVE web product
// at whiteintel.dev. Same model many fintechs use (Coinbase, Stripe, Revolut).
// All cloud features work day-one; native plumbing adds splash, status bar,
// deep links, file picker, share, secure preferences, network awareness.
//
// v0.2 strategy (roadmapped, NOT in this scaffold): mobile-side local RAG via
// a Capacitor plugin wrapping llama.cpp's Android NDK + iOS framework, OR via
// WebGPU + transformers.js for a smaller model. See README.md.
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.whiteintel.app",
  appName: "WhiteIntel",
  webDir: "www",
  // Point the WebView at the live product. The 'www' dir is the offline
  // fallback — shown when the device is offline before the first server reach.
  server: {
    url: "https://whiteintel.dev",
    cleartext: false,
    // Only allow our own origin to be loaded as the app's root navigation.
    allowNavigation: ["whiteintel.dev", "*.whiteintel.dev"],
  },
  android: {
    allowMixedContent: false,
    // Use the brand background while the WebView paints the first frame.
    backgroundColor: "#f4ede1",
  },
  ios: {
    contentInset: "always",
    backgroundColor: "#f4ede1",
    limitsNavigationsToAppBoundDomains: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: "#f4ede1",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      androidSplashResourceName: "splash",
    },
    StatusBar: {
      style: "DARK", // dark text on the paper-colored brand background
      backgroundColor: "#f4ede1",
      overlaysWebView: false,
    },
  },
};

export default config;
