import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The app is a native shell around the live site: the WebView loads https://gymandtonic.dev,
 * so every web deploy updates the app without a new APK, and Cloudflare Access login works
 * exactly as in the browser (same origin, same cookies). Native features (Health Connect) are
 * reached through Capacitor's bridge, which is injected into the remote page.
 */
const config: CapacitorConfig = {
  appId: "dev.gymandtonic.trailblazer",
  appName: "Trailblazer",
  // Only used for the offline/error page and the Health Connect privacy policy.
  webDir: "www",
  appendUserAgent: "TrailblazerAndroid",
  server: {
    url: "https://gymandtonic.dev",
    // Keep the Cloudflare Access login flow inside the app instead of bouncing to Chrome.
    allowNavigation: ["gymandtonic.dev", "*.cloudflareaccess.com", "dash.cloudflare.com", "*.cloudflare.com"],
    errorPath: "offline.html",
  },
  android: {
    // chrome://inspect works on debug builds; never on release builds.
    webContentsDebuggingEnabled: true,
  },
};

export default config;
