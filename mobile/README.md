# WhiteIntel Mobile

Native Android (APK / AAB) + iOS (IPA) shell wrapping the WhiteIntel web product. Capacitor 6 — the same approach Coinbase, Stripe, Revolut and most fintech apps use today.

## v0.1 scope (this scaffold)

- One native binary per platform that loads **whiteintel.dev** in a hardened WebView
- Brand splash + status bar + safe-area handling (iOS notch + Android navigation bar)
- Offline fallback page that says exactly that, with a Retry button
- Whitelisted navigation — the app cannot be redirected off our origin
- Capacitor plugins available to the web app: App (deep links + state), Browser (in-app links), Filesystem, Network (online/offline awareness), Preferences (secure key/value), Share, Splash Screen, Status Bar
- Asset pipeline (`@capacitor/assets`) for icon + splash generation from a single 1024×1024 PNG

**Not in v0.1**: on-device LLM / RAG. Mobile local-AI is staged for v0.2 — see [Local AI on mobile (v0.2)](#local-ai-on-mobile-v02) below for the honest plan.

## Directory layout

```
mobile/
├─ capacitor.config.ts     # Capacitor 6 config — appId, server.url, plugins
├─ www/index.html          # offline fallback (network-aware retry)
├─ resources/              # drop icon.png (1024×1024) + splash.png here
├─ package.json            # capacitor + plugin deps, scripts
└─ README.md
```

When you run `npm run init:android` / `init:ios` Capacitor materialises `android/` and `ios/` directories with the full native project trees (Gradle, Xcode). Those are kept out of git (`.gitignore`) until you've added signing config + assets — at that point you commit specific subpaths (manifest, keystore-config, custom plugins) but never the Gradle/CocoaPods caches.

## Build flow

### Prereqs
- Node 20+
- **Android**: Android Studio 2024.x + Android SDK 34, JDK 17. Set `ANDROID_HOME` and ensure `adb` + the build-tools are on PATH.
- **iOS** (macOS only): Xcode 16, CocoaPods (`brew install cocoapods`), an Apple Developer account for store submission.

### One-time setup
```bash
cd mobile
npm install

# Generate the native project trees (creates ./android and ./ios)
npm run init:android       # = npx cap add android
npm run init:ios           # = npx cap add ios   (macOS only)

# Drop your icon.png + splash.png into ./resources then:
npx capacitor-assets generate
```

### Iterating
```bash
npm run sync               # propagates config + plugins → native projects
npm run open:android       # opens Android Studio
npm run open:ios           # opens Xcode
npm run run:android        # builds + installs on a connected device / emulator
```

### Producing installers

**Android APK (debug, for sideloading):**
```bash
npm run build:android:debug
# → mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

**Android AAB (store-ready, needs a keystore):**
```bash
# 1. Generate a keystore once (keep this file safe — losing it = losing the listing)
keytool -genkey -v -keystore whiteintel.keystore -alias whiteintel -keyalg RSA -keysize 2048 -validity 10000

# 2. Wire it into android/gradle.properties + android/app/build.gradle
#    (see https://capacitorjs.com/docs/v6/android/deploying-to-google-play)

# 3. Build the AAB
cd android && ./gradlew bundleRelease
# → mobile/android/app/build/outputs/bundle/release/app-release.aab
```

**iOS IPA:**
```bash
npm run open:ios           # opens Xcode
# In Xcode: Product → Archive, then Distribute App → App Store Connect.
# Notarization happens automatically through Apple's signing flow.
```

## Live-app vs bundled-app

This scaffold uses `server.url = https://whiteintel.dev` — the WebView loads the live product on every launch. That gets the app shipped fastest and means every web deploy is also a mobile deploy.

If app-store reviewers push back on the "thin wrapper" pattern (Apple is stricter on this), the alternative is to ship a TanStack Start static-export bundle inside the app and point the WebView at the local files. That requires a static prerender step in `app/` — a 2-day effort, separate sprint.

## Local AI on mobile (v0.2 — honest plan)

Local LLMs on a phone are real but constrained:

| Device class | Free RAM | Realistic chat model | Tokens/sec |
| --- | --- | --- | --- |
| iPhone 15 Pro / Pixel 9 Pro | 6–8 GB | Qwen2.5-3B Q4_K_M (~1.9 GB) | 8–15 |
| iPhone 12 / Pixel 7 / S22 | 3–4 GB | Gemma-2-2B Q4 (~1.6 GB) | 5–10 |
| Mid-range Android (4 GB) | 2 GB | Phi-3.5-mini Q4 (~2.4 GB) | not viable |

Two paths for v0.2, both viable, both shipped in production by others:

### Path A — `llama.cpp` via a Capacitor plugin
Wrap `llama.cpp`'s Android NDK build (JNI bridge) and iOS framework into a Capacitor plugin we own. References:
- Android: `llama.cpp/examples/llama.android` — official Kotlin/JNI sample
- iOS: `llama.cpp/examples/llama.swiftui` — official Swift package

The plugin exposes `embed(text)`, `chat(prompt, onToken)` over Capacitor's bridge — same shape as `desktop/src/local/llm.ts`, so the renderer code can be shared with desktop.

Effort: 3–5 days. Best performance, best control.

### Path B — WebGPU + `transformers.js`
Chrome on Android (≥ 121) and Safari on iOS (≥ 18) ship WebGPU. `@xenova/transformers` runs ONNX models via WebGPU at near-native speed. The same web-app code that runs in desktop Electron would just-work in mobile WebView.

Effort: 1–2 days. Limited model selection. Older devices fall back to CPU WASM (slow).

**Recommendation**: ship v0.1 as the live-app wrapper to get into the stores fast; build Path A for v0.2 (we control the API and can match desktop exactly).

## Security model

- The WebView is locked to `whiteintel.dev` via `server.allowNavigation` — clicking an external link goes through the `@capacitor/browser` in-app browser (SFSafariViewController on iOS, Custom Tabs on Android), not the in-WebView nav.
- iOS `limitsNavigationsToAppBoundDomains: true` enforces the same at the platform level (App-Bound Domains).
- `cleartext: false` blocks HTTP — only HTTPS to our origin.
- `Preferences` plugin uses iOS Keychain / Android EncryptedSharedPreferences — that's where the session token will live (replacing the localStorage JWT from the web app's audit Phase 1).

## Roadmap

- v0.1 — this scaffold (live-app shell)
- v0.2 — local LLM + RAG via a Capacitor plugin (Path A)
- v0.3 — Push notifications (FCM + APNs) for watchlist alerts
- v0.4 — Biometric unlock (`@capacitor/biometric-auth`) over the session JWT
- v0.5 — Offline-first watchlist (sync via a local SQLite + queued mutations)
- v1.0 — Store submissions: Google Play (closed → open testing → production), App Store (TestFlight → production)
