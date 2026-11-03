# Android app build guide

The repository already includes Capacitor configuration, the native Android project, and Gradle release-signing support. Do not run `cap init` or `cap add android` again for an ordinary checkout.

## Prerequisites

- Node.js 22.12+ and npm on the Android build process's PATH
- Android Studio, Android SDK, and an emulator or device
- A JDK compatible with the checked-in [Gradle wrapper](../android/gradle/wrapper/gradle-wrapper.properties) and [Android Gradle plugin](../android/build.gradle)

Commands below start at the repository root and use a Linux/macOS shell. On Windows, use `gradlew.bat` instead of `./gradlew`.

```bash
npm ci
```

If Gradle reports `SDK location not found`, create machine-local `android/local.properties` (do not commit it):

```properties
sdk.dir=<your-android-sdk-path>
```

Examples:

- macOS: `sdk.dir=/Users/<your-user>/Library/Android/sdk`
- Linux: `sdk.dir=/home/<your-user>/Android/Sdk`
- Windows: `sdk.dir=C:\\Users\\<your-user>\\AppData\\Local\\Android\\Sdk`

## Backend and web assets

[`npm run build:android`](../package.json) builds with [`.env.android`](../.env.android), selecting local mode and clearing baked-in Supabase values, then runs Capacitor sync.

```bash
npm run lint
node --test scripts/category-archive.test.js scripts/helpers.test.js
npm run build:android
npx cap open android
```

Do **not** use plain `npm run build` for this self-hosted Android app: it may bake in Supabase settings from `.env`.

At first launch, choose **Connect to your server**, enter the server root URL, and test the connection. Setup reads the server's `/env-config.js` and checks `/auth/v1/health` for local mode. The server must be reachable from the phone, with the configured WebView CORS origins allowed. See [self-hosted setup](./SETUP_GUIDE.md#self-hosted-local-postgres).

Gradle's [preBuild tasks](../android/app/build.gradle) rebuild the Android-mode web app and copy it into the native project before debug/release builds, including Android Studio **Run**. After plugin changes, run `npm run build:android` **before** Gradle configures the project; copying assets alone does not sync native plugins.

## Release signing

Create an upload keystore once and keep it secure. Keep the same signing key to update an existing installation.

```bash
keytool -genkey -v \
  -keystore android/upload-keystore.jks \
  -alias budgetapp-upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

Create private `android/keystore.properties`:

```properties
storeFile=upload-keystore.jks
storePassword=<your-store-password>
keyAlias=budgetapp-upload
keyPassword=<your-key-password>
```

The existing [app Gradle configuration](../android/app/build.gradle) loads these values relative to the Android project root. The keystore, signing properties, and local SDK properties are already [ignored](../.gitignore); do not commit them.

## Build and install releases

Update `versionCode` and `versionName` in [app Gradle configuration](../android/app/build.gradle). Keep the application ID `com.samgunvalson.budgetapp` stable.

```bash
npm run build:android
cd android
./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

Artifacts, relative to the repository root:

| Command, run inside `android/` | Artifact |
| --- | --- |
| `./gradlew assembleRelease` | `android/app/build/outputs/apk/release/app-release.apk` for direct installation |
| `./gradlew bundleRelease` | `android/app/build/outputs/bundle/release/app-release.aab` for Google Play |
| `./gradlew assembleRelease bundleRelease` | Both formats |

An AAB build does not update an existing APK. If the app appears unchanged, check the artifact's modification time and install the newly generated APK. Changing the version or clearing phone data cannot replace embedded code.

For Google Play, complete the app content/privacy, data safety, content rating, and audience forms; upload the AAB to internal testing and validate updates before production.

## Device smoke checks

- Sign in and restart the app; confirm session persistence and data loading.
- Add/edit/delete a transaction, create a write offline, reconnect, and confirm sync.
- Check refresh on launch, reconnect, foreground resume, and tapping the sync status dot.
- Check both themes and safe mode.
- Check **Archive** and **Show archived** on Categories. Archived categories remain in history/saved entries but not new-entry choices.
- If archive writes fail with a current UI, verify the [category-archiving migration](./SETUP_GUIDE.md#category-archiving-upgrade) on the server.
- Test real-device network/Tailscale access and actionable server-connection errors before release.
