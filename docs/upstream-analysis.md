# Upstream Analysis

Repository analyzed: [`KaladinDMP/apprenticeVrSrc`](https://github.com/KaladinDMP/apprenticeVrSrc)

## Architecture summary

The upstream repo is an Electron + React desktop app with three main backend concerns:

- `src/main/services/adbService.ts`
  Handles Quest discovery, package installation, shell commands, and file push/pull through ADB.

- `src/main/services/gameService.ts`
  Manages the catalog sync flow. It loads a `baseUri` and `password`, downloads `meta.7z`, extracts it, and parses the resulting game list.

- `src/main/services/downloadService.ts` and `src/main/services/download/downloadProcessor.ts`
  Queue and process downloads, then install them to the selected headset.

## Key catalog and download behavior

From the analyzed code:

- `gameService.ts` downloads `meta.7z` either from an active mirror path like `Quest Games/meta.7z` or from a configured HTTP endpoint.
- `gameService.ts` extracts that archive with a password from the saved server config.
- `downloadProcessor.ts` downloads release payloads either from a mirror path under `Quest Games/<releaseName>` or from a hashed public HTTP path derived from `md5(releaseName + "\n")`.

That means the upstream product flow is not just a neutral Quest installer UI. Its library sync and payload acquisition depend on an external distribution system.

## What this repo keeps

This web version keeps the reusable product ideas:

- Quest connection
- Installed-package inspection
- A browsable library UI
- APK installation
- OBB upload

## What this repo intentionally does not port

This repo does not implement:

- remote mirror sync
- password-protected catalog extraction
- external hashed content endpoints
- any browser clone of the upstream distribution backend

Instead, it expects:

- a local manifest JSON that describes software the user already owns
- local `APK` and optional `OBB` files selected by the user in the browser
