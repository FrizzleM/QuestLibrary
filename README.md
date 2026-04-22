# Quest Library Browser

A browser-first Quest sideloader built with React, Vite, WebUSB, and Tango ADB.

This project was created after analyzing [`KaladinDMP/apprenticeVrSrc`](https://github.com/KaladinDMP/apprenticeVrSrc), but it does **not** recreate that repo's external game distribution backend. Instead, it keeps the parts that are useful and lawful in a browser:

- Connect a Meta Quest headset over `WebUSB`
- Authenticate with ADB directly in Chrome or Edge
- Inspect installed third-party packages
- Read a generated remote catalog snapshot without exposing source secrets to the browser
- Browse a manifest for software you already own
- Install local `APK` files and upload matching `OBB` files from the browser

## Why this differs from the upstream repo

The upstream Electron app is structured around:

- `adbService.ts` for device communication
- `gameService.ts` for syncing a game catalog
- `downloadService.ts` and `downloadProcessor.ts` for pulling payloads and installing them

During analysis, the catalog and download layer was found to be tied to password-protected `meta.7z` sync plus mirror/public endpoints for `Quest Games` content. This web app intentionally does **not** port that remote distribution path.

More detail is in [docs/upstream-analysis.md](/workspaces/QuestLibrary/docs/upstream-analysis.md).

## Features

- Quest connection over `@yume-chan/adb-daemon-webusb`
- Local-storage ADB key persistence so trusted devices reconnect cleanly
- Device summary and installed package explorer
- Daily GitHub Actions catalog refresh that writes `public/remote-catalog.json`
- Manifest-driven library browser for local APK/OBB collections
- Quick Install mode for manual sideloading without a manifest
- Build-time verified Vite bundle

## Local development

```bash
npm install
npm run dev
```

Because WebUSB requires a secure context, use one of these:

- `http://localhost:<port>` during local development
- `https://...` in a deployed environment

Compatible browsers:

- Chrome
- Edge
- Other Chromium-based browsers with WebUSB enabled

## Scheduled catalog refresh

This repo now includes a daily GitHub Actions workflow at [.github/workflows/refresh-remote-catalog.yml](/workspaces/QuestLibrary/.github/workflows/refresh-remote-catalog.yml).

What it does:

- downloads `meta.7z` on the runner
- extracts it with `7z`
- parses the upstream game list and notes
- writes a static snapshot to [public/remote-catalog.json](/workspaces/QuestLibrary/public/remote-catalog.json)
- commits the refreshed JSON back to the repository if it changed

Required GitHub repository secrets:

- `CATALOG_BASE_URI`
- `CATALOG_PASSWORD_B64`

You can also run the same refresh locally if `7z` is installed:

```bash
CATALOG_BASE_URI="https://example.invalid/" \
CATALOG_PASSWORD_B64="base64-password" \
npm run catalog:refresh
```

The browser only reads the generated JSON snapshot. The protected source URI and password stay inside the workflow environment.

## Using the app

1. Put the Quest in developer mode and connect it by USB.
2. Open the app in a supported browser.
3. Click `Connect Quest`.
4. Accept the USB debugging prompt inside the headset if it appears.
5. Browse the generated remote catalog snapshot if the workflow has populated it.
6. Either:
   - import a manifest JSON plus matching local `APK` and `OBB` files, or
   - use `Quick Install` and choose files manually.
7. Install from the selected manifest entry or the manual install deck.

## Manifest format

A sample manifest is included at [public/sample-owned-library.json](/workspaces/QuestLibrary/public/sample-owned-library.json).

Example:

```json
{
  "version": 1,
  "title": "Owned Quest Builds",
  "ownershipStatement": "Only install software you own or have rights to sideload.",
  "games": [
    {
      "id": "orbit-atelier",
      "title": "Orbit Atelier",
      "packageName": "com.example.orbitatelier",
      "description": "My locally stored Quest build",
      "apks": [
        { "fileName": "orbit-atelier.apk", "label": "Base APK" }
      ],
      "obbs": [
        { "fileName": "main.42.com.example.orbitatelier.obb", "label": "Main OBB" }
      ]
    }
  ]
}
```

## Troubleshooting

- If Chrome says no devices are available, make sure the headset is unlocked and USB debugging is enabled.
- If another tool already owns the ADB USB interface, close SideQuest, Android Studio, or any local `adb` server and reconnect.
- If OBB upload fails, make sure the package name is correct. OBBs are pushed to `/sdcard/Android/obb/<package-name>/`.
- If the remote catalog stays empty, check the workflow run logs first. A `403` or extraction error usually means the runner could not download `meta.7z` or the password secret is wrong.

## Verification

The project currently passes:

```bash
npm run build
```
