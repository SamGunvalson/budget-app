# Android App Build Guide (Budget App)

This is a repo-specific, end-to-end checklist to package this Vite + React PWA as a real Android app using Capacitor and produce a Play Store upload (`.aab`).

> Assumptions used below:
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

This repo reads Supabase values from Vite env at build time (and only uses `window.__ENV__` if placeholders are replaced). For Android builds, set real values in `.env.production`.

```bash
cd /workspaces/budget-app
cp .env.example .env.production
```

Edit `.env.production` to real values:

```env
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

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

Run repo checks first (this repo has lint, no test suite):

```bash
cd /workspaces/budget-app
npm run lint
npm run build
npx cap sync android
```

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
   - Login/signup (Supabase auth)
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
npm run build
npx cap sync android
```

Then build release:

```bash
cd /workspaces/budget-app/android
./gradlew bundleRelease
```

Upload the new `.aab` to Play Console.

---

## 10) Repo-specific gotchas to remember

- This app uses Dexie + sync queue + Supabase auth: always test offline/online and auth state transitions on a real device before release.
- Supabase values for mobile are baked at web build time here; always confirm `.env.production` is correct before `npm run build`.
- Keep `applicationId` stable once published (do not change after first Play release).
- Any web code change requires rebuild + `npx cap sync android` before Android run/release.
