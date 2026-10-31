# Android App Build Guide (Budget App)

This is a repo-specific, end-to-end checklist to package this Vite + React PWA as a real Android app using Capacitor and produce a Play Store upload (`.aab`).

> Assumptions used below:
>
> - App name: `Budget App`
> - Android application ID: `com.samgunvalson.budgetapp`
> - Build machine is Linux/macOS shell (adjust paths for Windows)

---

## 0) Prerequisites (one-time on your machine)

1. Install:
   - Node 18+ (repo already expects Node)
   - Android Studio (with Android SDK + emulator)
   - Java 17 (recommended for current Android Gradle tooling)

2. From repo root, install JS deps:

```bash
cd /workspaces/budget-app
npm install
```

---

## 1) Prepare production environment values

Android builds use [`.env.android`](../.env.android), which selects the local
backend and clears baked-in Supabase values. Do not use plain `npm run build`
or configure `.env.production` for this self-hosted Android app.

For the self-hosted local backend, the generic app build can be configured on
the device instead of baking in Supabase credentials. When first launched, use
**Connect to your server**, enter the self-hosted server's root URL (for example
`https://budget.<tailnet>.ts.net`), and test the connection. The app reads
`BACKEND_MODE` from that server's `/env-config.js`; when it is `local`, setup
checks `/auth/v1/health` before saving the server. The server must be reachable
from the phone, and its CORS policy allows the Capacitor WebView origins. See
[Self-hosted setup](./SETUP_GUIDE.md#self-hosted-local-postgres).

---

## 2) Add Capacitor to this repo (first-time setup)

```bash
cd /workspaces/budget-app
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Budget App" "com.samgunvalson.budgetapp" --web-dir=dist
npx cap add android
```

This creates:

- `capacitor.config.*`
- `android/` native project

---

## 3) Build web app and sync into Android project

Run repo checks and prepare the native project:

```bash
cd /workspaces/budget-app
npm run lint
node --test scripts/category-archive.test.js
npm run build:android
```

Gradle's `preBuild` also runs an Android-mode Vite build and `cap copy android`
before every debug/release build, including Android Studio **Run**. Both commands
must succeed before native compilation can proceed. Node/npm must be installed
and on the Android build process's PATH.

`cap copy` refreshes the embedded web app, not native plugin dependencies. After
adding or updating Capacitor plugins, run `npm run build:android` before starting
Gradle so `cap sync` updates native configuration before Gradle reads it.

---

## 4) Run the Android app locally (debug)

1. Open native project:

    ```bash
    cd /workspaces/budget-app
    npx cap open android
    ```

2. In Android Studio:
   - Let Gradle sync finish
   - Start an emulator (or connect device)
   - Click **Run**

3. Smoke test in app:
   - Login/signup (the configured backend auth adapter)
   - Add/edit/delete transaction
   - Go offline, create data, go online, confirm sync
   - Restart app, confirm session persistence and data load

---

## 5) Prepare release signing key (one-time)

Create an upload keystore (store this securely):

```bash
cd /workspaces/budget-app
keytool -genkey -v \
  -keystore android/upload-keystore.jks \
  -alias budgetapp-upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

Create `android/keystore.properties`:

```properties
storeFile=upload-keystore.jks
storePassword=<your-store-password>
keyAlias=budgetapp-upload
keyPassword=<your-key-password>
```

---

## 6) Configure Gradle release signing

Edit `android/app/build.gradle` (or `build.gradle.kts` if generated as Kotlin DSL) to load `keystore.properties` and wire `signingConfigs.release` into `buildTypes.release`.

If your project generated **Groovy** `build.gradle`, use this pattern:

```gradle
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file("keystore.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                keyAlias keystoreProperties["keyAlias"]
                keyPassword keystoreProperties["keyPassword"]
                storeFile file(keystoreProperties["storeFile"])
                storePassword keystoreProperties["storePassword"]
            }
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
        }
    }
}
```

Also ensure `android/keystore.properties` and `android/upload-keystore.jks` are ignored by git (add to `.gitignore` if needed):

```bash
cd /workspaces/budget-app
printf "\nandroid/keystore.properties\nandroid/upload-keystore.jks\n" >> .gitignore
```

---

## 7) Build Play Store artifact (`.aab`)

If you see `SDK location not found`, create `android/local.properties` first (do not commit this file):

```properties
sdk.dir=<your-android-sdk-path>
```

Examples:

- macOS: `sdk.dir=/Users/<your-user>/Library/Android/sdk`
- Linux: `sdk.dir=/home/<your-user>/Android/Sdk`
- Windows: `sdk.dir=C:\\Users\\<your-user>\\AppData\\Local\\Android\\Sdk`

```bash
cd /workspaces/budget-app/android
./gradlew clean
./gradlew bundleRelease
```

Output bundle:

```text
android/app/build/outputs/bundle/release/app-release.aab
```

---

## 8) Play Console upload (first release)

1. Create app in Google Play Console
2. Complete:
   - App content + privacy policy
   - Data safety form
   - Content rating
   - Target audience
3. Upload `app-release.aab` to **Internal testing**
4. Add testers, validate install/update
5. Promote to production

---

## 9) Ongoing release commands (every update)

From repo root:

```bash
cd /workspaces/budget-app
npm run lint
npm run build:android   # vite build --mode android && cap sync android
```

`build:android` loads [`.env.android`](../.env.android), which forces
`VITE_BACKEND_MODE=local` and blanks the Supabase values. Do **not** use plain
`npm run build` for the APK: it reads `.env`, and if that contains Supabase
credentials the app silently connects to Supabase, never shows **Connect to
your server**, and shows different data than your self-hosted web app.

Bump the versionCode and versionName in `android/app/build.gradle` as needed.

```bash
versionCode 2
versionName "1.0.1"
```

Then build the signed APK for direct installation on your phone (outside of dev container):

```bash
npm run build:android
cd /android
./gradlew assembleRelease
```

The updated APK is at `android/app/build/outputs/apk/release/app-release.apk`
(relative to the repo root). Copy this file to your phone to install it, or
sideload it from the `android/` directory:

```bash
adb install -r app/build/outputs/apk/release/app-release.apk
```

For a Play Store update, run `./gradlew bundleRelease` instead and upload
`android/app/build/outputs/bundle/release/app-release.aab` to Play Console.
`bundleRelease` only creates the `.aab`; it does **not** update an existing
`app-release.apk`. To generate both formats, run
`./gradlew assembleRelease bundleRelease`.

If the APK appears unchanged, check its modification time and confirm you ran
`assembleRelease`, not just `bundleRelease` or `npm run build`. Gradle now
refreshes web assets automatically; changing `versionName` alone previously
could package stale assets under a new version number. Clearing app data or
reinstalling the same APK cannot replace that embedded code.

For category archiving, confirm **Archive** buttons and **Show archived** appear
on Categories. Archived categories should be absent from new transaction choices,
but remain labeled in historical filters and existing saved entries. If the UI
is current but archive writes fail, verify the server's
[category-archiving migration](./SETUP_GUIDE.md#category-archiving-upgrade)
has been applied.

Direct installation also requires the release signing key configured
in steps 5 and 6; keep using the same key to update an existing installation.

---

## 10) Repo-specific gotchas to remember

- This app uses Dexie + sync queue + the configured backend auth adapter: always test offline/online and auth state transitions on a real device before release.
- Backend values for mobile are baked at web build time. Use `npm run build:android` for self-hosted builds; to check which backend an APK uses, look for **Connect to your server** on first launch (self-hosted) vs. going straight to login (Supabase baked in).
- The app pulls fresh data on launch, on reconnect, when brought back to the foreground, and when you tap the sync status dot in the top bar.
- Keep `applicationId` stable once published (do not change after first Play release).
- Gradle rebuilds and copies web assets before Android run/release. Native plugin changes still require `npm run build:android` before starting Gradle.
- If you ship a generic app build (no fixed env values), first launch now opens a **Connect to your server** screen before login. Enter your server root URL (for example `https://budget.<tailnet>.ts.net`) and run **Test connection**.
- Connection errors are surfaced with actionable messages (offline device, timeout, invalid server config, TLS issues, unreachable server) so users know whether they need Tailscale/network access or server-side config fixes.
