import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'

import './App.css'
import { sampleLibraryManifest } from './data/sampleLibrary'
import { dedupeFiles, parseLibraryManifest, resolveGameAssets } from './lib/manifest'
import { QuestBridge } from './lib/questBridge'
import type {
  ActivityEntry,
  ActivityLevel,
  BundleObbFile,
  DeviceSummary,
  InstallBundle,
  InstalledPackageInfo,
  InstallProgressSnapshot,
  LibraryManifest,
  RemoteCatalog,
  RemoteCatalogSourceConfig,
} from './types'

const SUPPORTS_WEBUSB = typeof window !== 'undefined' && QuestBridge.isSupported()

function createActivity(level: ActivityLevel, message: string): ActivityEntry {
  return {
    id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    level,
    message,
    timestamp: new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date()),
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

function formatCatalogDate(value: string | null): string {
  if (!value) {
    return 'No generated snapshot yet'
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'The USB device picker was closed before a headset was selected.'
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Unknown error'
}

function fileListToArray(files: FileList | null): File[] {
  return files ? [...files] : []
}

function buildObbBundle(packageName: string, obbFiles: { file: File; targetPath?: string }[]): BundleObbFile[] {
  return obbFiles.map(({ file, targetPath }) => ({
    file,
    targetPath: targetPath || `/sdcard/Android/obb/${packageName}/${file.name}`,
  }))
}

function App() {
  const manifestInputRef = useRef<HTMLInputElement>(null)
  const assetInputRef = useRef<HTMLInputElement>(null)
  const manualApkInputRef = useRef<HTMLInputElement>(null)
  const manualObbInputRef = useRef<HTMLInputElement>(null)

  const [bridge, setBridge] = useState<QuestBridge | null>(null)
  const [connectionState, setConnectionState] = useState<
    'unsupported' | 'idle' | 'connecting' | 'connected'
  >(SUPPORTS_WEBUSB ? 'idle' : 'unsupported')
  const [deviceSummary, setDeviceSummary] = useState<DeviceSummary | null>(null)
  const [installedPackages, setInstalledPackages] = useState<InstalledPackageInfo[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)

  const [manifest, setManifest] = useState<LibraryManifest>(sampleLibraryManifest)
  const [manifestSource, setManifestSource] = useState<'sample' | 'imported'>('sample')
  const [selectedGameId, setSelectedGameId] = useState(sampleLibraryManifest.games[0]?.id ?? '')
  const [assetFiles, setAssetFiles] = useState<File[]>([])

  const [manualApkFiles, setManualApkFiles] = useState<File[]>([])
  const [manualObbFiles, setManualObbFiles] = useState<File[]>([])
  const [manualPackageName, setManualPackageName] = useState('')

  const [remoteCatalog, setRemoteCatalog] = useState<RemoteCatalog | null>(null)
  const [remoteCatalogStatus, setRemoteCatalogStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  const [remoteCatalogError, setRemoteCatalogError] = useState('')
  const [remoteSearch, setRemoteSearch] = useState('')
  const [librarySearch, setLibrarySearch] = useState('')
  const [packageSearch, setPackageSearch] = useState('')
  const deferredRemoteSearch = useDeferredValue(remoteSearch)
  const deferredLibrarySearch = useDeferredValue(librarySearch)
  const deferredPackageSearch = useDeferredValue(packageSearch)

  const [installProgress, setInstallProgress] = useState<InstallProgressSnapshot>({
    phase: SUPPORTS_WEBUSB ? 'idle' : 'error',
    label: 'Quest install deck',
    detail: SUPPORTS_WEBUSB
      ? 'Connect a headset, load your own APK/OBB library, and install from the browser.'
      : 'WebUSB requires a secure Chromium-based browser such as Chrome or Edge.',
  })
  const [activity, setActivity] = useState<ActivityEntry[]>(() => [
    createActivity(
      SUPPORTS_WEBUSB ? 'info' : 'warning',
      SUPPORTS_WEBUSB
        ? 'Ready for a lawful Quest sideloading session.'
        : 'WebUSB is unavailable in this browser or context.',
    ),
  ])

  const activeSelectedGameId = manifest.games.some((game) => game.id === selectedGameId)
    ? selectedGameId
    : (manifest.games[0]?.id ?? '')
  const selectedGame = manifest.games.find((game) => game.id === activeSelectedGameId) ?? null
  const selectedGameAssets = selectedGame ? resolveGameAssets(selectedGame, assetFiles) : null
  const visibleRemoteGames = (remoteCatalog?.games ?? []).filter((game) => {
    const haystack = [game.title, game.packageName, game.releaseName, game.note]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return haystack.includes(deferredRemoteSearch.trim().toLowerCase())
  })

  const visibleGames = manifest.games.filter((game) => {
    const haystack = [game.title, game.developer, game.packageName, game.description, ...(game.genres ?? [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return haystack.includes(deferredLibrarySearch.trim().toLowerCase())
  })

  const visiblePackages = installedPackages.filter((entry) => {
    const haystack = [entry.packageName, entry.installer, entry.sourceDir]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return haystack.includes(deferredPackageSearch.trim().toLowerCase())
  })

  const appendActivity = (level: ActivityLevel, message: string) => {
    setActivity((current) => [createActivity(level, message), ...current].slice(0, 18))
  }

  function applyDisconnectedState(): void {
    setBridge(null)
    setConnectionState(SUPPORTS_WEBUSB ? 'idle' : 'unsupported')
    setDeviceSummary(null)
    setInstalledPackages([])
    setInstallProgress({
      phase: 'idle',
      label: 'Quest install deck',
      detail: 'Quest disconnected. Reconnect to continue.',
    })
    appendActivity('warning', 'Quest disconnected.')
  }

  const handleBridgeDisconnectedEffect = useEffectEvent(() => {
    applyDisconnectedState()
  })

  useEffect(() => {
    if (!bridge) {
      return
    }

    let active = true

    bridge.disconnected
      .then(() => {
        if (active) {
          handleBridgeDisconnectedEffect()
        }
      })
      .catch(() => {
        if (active) {
          handleBridgeDisconnectedEffect()
        }
      })

    return () => {
      active = false
    }
  }, [bridge])

  useEffect(() => {
    let cancelled = false

    async function loadRemoteCatalog() {
      setRemoteCatalogStatus('loading')
      setRemoteCatalogError('')

      try {
        const sourceResponse = await fetch('/remote-catalog-source.json', { cache: 'no-store' })

        if (!sourceResponse.ok) {
          throw new Error(`Catalog source config request failed with HTTP ${sourceResponse.status}`)
        }

        const sourceConfig = (await sourceResponse.json()) as RemoteCatalogSourceConfig
        const baseUri = sourceConfig.baseUri?.trim()
        const password = sourceConfig.password?.trim()

        if (!baseUri) {
          throw new Error('Catalog source config is missing "baseUri".')
        }

        if (!password) {
          throw new Error('Catalog source config is missing "password".')
        }

        const catalogUrl = new URL('remote-catalog.json', baseUri)
        catalogUrl.searchParams.set('password', password)

        const response = await fetch(catalogUrl.toString(), {
          cache: 'no-store',
        })

        if (!response.ok) {
          throw new Error(`Catalog request failed with HTTP ${response.status}`)
        }

        const data = (await response.json()) as RemoteCatalog

        if (cancelled) {
          return
        }

        setRemoteCatalog(data)
        setRemoteCatalogStatus(data.games.length > 0 ? 'ready' : 'empty')
      } catch (error) {
        if (cancelled) {
          return
        }

        setRemoteCatalog(null)
        setRemoteCatalogStatus('error')
        setRemoteCatalogError(describeError(error))
      }
    }

    void loadRemoteCatalog()

    return () => {
      cancelled = true
    }
  }, [])

  async function refreshDeviceSnapshot(activeBridge: QuestBridge = bridge as QuestBridge): Promise<void> {
    if (!activeBridge) {
      return
    }

    setIsRefreshing(true)

    try {
      const [summary, packages] = await Promise.all([
        activeBridge.getDeviceSummary(),
        activeBridge.listInstalledPackages(),
      ])

      setDeviceSummary(summary)
      setInstalledPackages(packages)
    } finally {
      setIsRefreshing(false)
    }
  }

  async function handleConnect(): Promise<void> {
    if (!SUPPORTS_WEBUSB) {
      return
    }

    setConnectionState('connecting')
    appendActivity('info', 'Requesting USB access to the Quest.')

    try {
      const nextBridge = await QuestBridge.connect()
      setBridge(nextBridge)
      setConnectionState('connected')
      setInstallProgress({
        phase: 'idle',
        label: 'Quest install deck',
        detail: 'Quest connected. Accept the USB debugging prompt inside the headset if it appears.',
      })
      appendActivity(
        'success',
        'Quest connected. If the headset shows an authorization prompt, approve it once to finish ADB setup.',
      )
      await refreshDeviceSnapshot(nextBridge)
    } catch (error) {
      setConnectionState('idle')
      appendActivity('error', describeError(error))
    }
  }

  async function handleDisconnect(): Promise<void> {
    if (!bridge) {
      return
    }

    await bridge.disconnect().catch(() => {
      // The device may already be gone.
    })
    applyDisconnectedState()
  }

  async function runInstall(bundle: InstallBundle): Promise<void> {
    if (!bridge) {
      appendActivity('warning', 'Connect a Quest before starting an install.')
      return
    }

    setIsInstalling(true)
    setInstallProgress({
      phase: 'uploading-apk',
      percent: 0,
      label: bundle.label,
      detail: 'Preparing install session…',
    })
    appendActivity('info', `Starting install for ${bundle.label}.`)

    try {
      await bridge.installBundle(bundle, (snapshot) => {
        setInstallProgress(snapshot)
      })

      appendActivity('success', `Install finished for ${bundle.label}.`)
      await refreshDeviceSnapshot(bridge)
    } catch (error) {
      appendActivity('error', `Install failed for ${bundle.label}: ${describeError(error)}`)
    } finally {
      setIsInstalling(false)
    }
  }

  async function handleInstallSelectedGame(): Promise<void> {
    if (!selectedGame || !selectedGameAssets) {
      return
    }

    if (selectedGameAssets.missingRequired.length > 0) {
      appendActivity(
        'warning',
        `Missing required files for ${selectedGame.title}: ${selectedGameAssets.missingRequired.join(', ')}`,
      )
      return
    }

    const apkFiles = selectedGameAssets.apks.flatMap((entry) => (entry.file ? [entry.file] : []))
    const obbFiles = buildObbBundle(
      selectedGame.packageName,
      selectedGameAssets.obbs.flatMap((entry) =>
        entry.file
          ? [
              {
                file: entry.file,
                targetPath: entry.spec.targetPath,
              },
            ]
          : [],
      ),
    )

    await runInstall({
      label: selectedGame.title,
      packageName: selectedGame.packageName,
      apkFiles,
      obbFiles,
    })
  }

  async function handleManualInstall(): Promise<void> {
    if (manualApkFiles.length === 0) {
      appendActivity('warning', 'Choose at least one APK before using Quick Install.')
      return
    }

    if (manualObbFiles.length > 0 && manualPackageName.trim() === '') {
      appendActivity('warning', 'Enter the package name before uploading OBB files.')
      return
    }

    await runInstall({
      label: manualPackageName.trim() || manualApkFiles[0].name,
      packageName: manualPackageName.trim() || undefined,
      apkFiles: manualApkFiles,
      obbFiles: buildObbBundle(
        manualPackageName.trim(),
        manualObbFiles.map((file) => ({ file })),
      ),
    })
  }

  async function handleManifestImport(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const [file] = fileListToArray(event.target.files)
    event.target.value = ''

    if (!file) {
      return
    }

    try {
      const nextManifest = parseLibraryManifest(await file.text())
      setManifest(nextManifest)
      setManifestSource('imported')
      setSelectedGameId(nextManifest.games[0]?.id ?? '')
      appendActivity('success', `Imported manifest "${nextManifest.title}".`)
    } catch (error) {
      appendActivity('error', `Manifest import failed: ${describeError(error)}`)
    }
  }

  function handleAssetImport(event: ChangeEvent<HTMLInputElement>): void {
    const nextFiles = fileListToArray(event.target.files)
    event.target.value = ''

    if (nextFiles.length === 0) {
      return
    }

    setAssetFiles((current) => dedupeFiles(current, nextFiles))
    appendActivity('success', `Imported ${nextFiles.length} library asset file${nextFiles.length === 1 ? '' : 's'}.`)
  }

  function handleManualApkImport(event: ChangeEvent<HTMLInputElement>): void {
    const nextFiles = fileListToArray(event.target.files)
    event.target.value = ''

    if (nextFiles.length === 0) {
      return
    }

    setManualApkFiles((current) => dedupeFiles(current, nextFiles))
  }

  function handleManualObbImport(event: ChangeEvent<HTMLInputElement>): void {
    const nextFiles = fileListToArray(event.target.files)
    event.target.value = ''

    if (nextFiles.length === 0) {
      return
    }

    setManualObbFiles((current) => dedupeFiles(current, nextFiles))
  }

  return (
    <div className="app-shell">
      <header className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Quest Library Browser</p>
          <h1>WebUSB sideloading for your own Quest app library.</h1>
          <p className="lede">
            This browser build keeps the useful pieces from the upstream sideloader workflow:
            connect a Meta Quest over WebUSB, inspect installed packages, browse a local manifest,
            and push APK/OBB files directly from the browser.
          </p>
        </div>
        <div className="hero-card">
          <div className={`status-chip status-${connectionState}`}>
            <span className="status-dot" />
            {connectionState === 'unsupported' && 'WebUSB unavailable'}
            {connectionState === 'idle' && 'Ready to connect'}
            {connectionState === 'connecting' && 'Connecting'}
            {connectionState === 'connected' && 'Quest linked'}
          </div>
          <p className="hero-card-copy">
            Secure context required. Chrome or Edge on `https://` or `http://localhost`.
          </p>
          <div className="hero-actions">
            <button
              className="button-primary"
              onClick={() => void handleConnect()}
              disabled={connectionState === 'connecting' || connectionState === 'connected' || !SUPPORTS_WEBUSB}
            >
              Connect Quest
            </button>
            <button
              className="button-ghost"
              onClick={() => void handleDisconnect()}
              disabled={!bridge}
            >
              Disconnect
            </button>
            <button
              className="button-ghost"
              onClick={() => void refreshDeviceSnapshot()}
              disabled={!bridge || isRefreshing}
            >
              {isRefreshing ? 'Refreshing…' : 'Refresh device'}
            </button>
          </div>
          <p className="hero-footnote">
            Works with software you created, bought, or otherwise have the rights to sideload. No
            third-party game mirror integration is included.
          </p>
        </div>
      </header>

      <section className="panel catalog-panel">
        <div className="panel-head">
          <div>
            <p className="panel-label">Catalog Snapshot</p>
            <h2>Remote library explorer</h2>
          </div>
          <span className="manifest-badge">
            {remoteCatalogStatus === 'loading' && 'Refreshing snapshot…'}
            {remoteCatalogStatus === 'ready' && formatCatalogDate(remoteCatalog?.generatedAt ?? null)}
            {remoteCatalogStatus === 'empty' && 'No snapshot generated yet'}
            {remoteCatalogStatus === 'error' && 'Snapshot unavailable'}
          </span>
        </div>

        <p className="muted-copy">
          This section reads a static catalog generated by the daily workflow. It keeps the protected
          source and password out of the browser while still letting the app browse the library metadata.
        </p>

        <div className="catalog-toolbar">
          <label className="search-field">
            <span>Search the remote snapshot</span>
            <input
              type="search"
              value={remoteSearch}
              onChange={(event) =>
                startTransition(() => {
                  setRemoteSearch(event.target.value)
                })
              }
              placeholder="Search titles, packages, release names…"
            />
          </label>
          <div className="catalog-meta">
            <span>{remoteCatalog?.stats.totalGames ?? 0} titles</span>
            <span>{remoteCatalog?.stats.noteCount ?? 0} notes</span>
            <span>{remoteCatalog?.source.baseUriHost || 'No source configured'}</span>
          </div>
        </div>

        {remoteCatalogStatus === 'ready' && remoteCatalog ? (
          <div className="catalog-grid">
            {visibleRemoteGames.slice(0, 18).map((game) => (
              <article key={game.id} className="catalog-card">
                <div className="catalog-card-header">
                  <div>
                    <h3>{game.title}</h3>
                    <p>{game.packageName}</p>
                  </div>
                  <strong>{game.downloads.toLocaleString()}</strong>
                </div>
                <div className="catalog-card-meta">
                  <span>{game.sizeLabel || 'Size unknown'}</span>
                  <span>{game.lastUpdated || 'Date unknown'}</span>
                  <span>{game.versionCode ? `vc ${game.versionCode}` : 'vc n/a'}</span>
                </div>
                <p className="catalog-card-release">Release: {game.releaseName}</p>
                {game.note ? <p className="catalog-card-note">{game.note}</p> : null}
              </article>
            ))}
          </div>
        ) : null}

        {remoteCatalogStatus === 'empty' ? (
          <div className="empty-state">
            <strong>No remote catalog has been generated yet.</strong>
            <p>
              Add the workflow secrets, run `Refresh Remote Catalog`, and this section will start
              showing the generated snapshot from `public/remote-catalog.json`.
            </p>
          </div>
        ) : null}

        {remoteCatalogStatus === 'error' ? (
          <div className="empty-state">
            <strong>Remote snapshot unavailable</strong>
            <p>{remoteCatalogError}</p>
          </div>
        ) : null}
      </section>

      <section className="workspace-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="panel-label">Device</p>
              <h2>Quest status</h2>
            </div>
          </div>

          <div className="device-summary">
            {deviceSummary ? (
              <>
                <div className="metric-card">
                  <span>Model</span>
                  <strong>{deviceSummary.name}</strong>
                </div>
                <div className="metric-card">
                  <span>Android</span>
                  <strong>
                    {deviceSummary.androidVersion} / SDK {deviceSummary.sdk}
                  </strong>
                </div>
                <div className="metric-card">
                  <span>Serial</span>
                  <strong>{deviceSummary.serial}</strong>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <strong>No headset connected</strong>
                <p>Attach a Quest over USB, enable developer mode, and allow USB debugging.</p>
              </div>
            )}
          </div>

          <div className="panel-subsection">
            <div className="panel-subhead">
              <h3>Installed packages</h3>
              <span>{visiblePackages.length}</span>
            </div>
            <label className="search-field">
              <span>Filter packages</span>
              <input
                type="search"
                value={packageSearch}
                onChange={(event) =>
                  startTransition(() => {
                    setPackageSearch(event.target.value)
                  })
                }
                placeholder="com.example…"
              />
            </label>
            <div className="package-list">
              {visiblePackages.length === 0 ? (
                <p className="muted-copy">
                  {bridge
                    ? 'No third-party packages matched this filter.'
                    : 'Package details appear here after a Quest is connected.'}
                </p>
              ) : (
                visiblePackages.map((entry) => (
                  <article key={entry.packageName} className="package-row">
                    <div>
                      <strong>{entry.packageName}</strong>
                      <p>{entry.installer || 'installer unknown'}</p>
                    </div>
                    <span>{entry.versionCode ? `vc ${entry.versionCode}` : 'n/a'}</span>
                  </article>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="panel-label">Library</p>
              <h2>{manifest.title}</h2>
            </div>
            <span className="manifest-badge">
              {manifestSource === 'sample' ? 'Sample manifest' : 'Imported manifest'}
            </span>
          </div>

          <p className="muted-copy">{manifest.description}</p>
          <p className="ownership-note">{manifest.ownershipStatement}</p>

          <div className="toolbar">
            <button className="button-ghost" onClick={() => manifestInputRef.current?.click()}>
              Import manifest
            </button>
            <button className="button-ghost" onClick={() => assetInputRef.current?.click()}>
              Import assets
            </button>
            <button
              className="button-ghost"
              onClick={() => {
                setManifest(sampleLibraryManifest)
                setManifestSource('sample')
                setSelectedGameId(sampleLibraryManifest.games[0]?.id ?? '')
                appendActivity('info', 'Loaded the built-in sample manifest.')
              }}
            >
              Load sample
            </button>
            <button
              className="button-ghost"
              onClick={() => {
                setAssetFiles([])
                appendActivity('info', 'Cleared imported library assets.')
              }}
              disabled={assetFiles.length === 0}
            >
              Clear assets
            </button>
          </div>

          <label className="search-field">
            <span>Search the library</span>
            <input
              type="search"
              value={librarySearch}
              onChange={(event) =>
                startTransition(() => {
                  setLibrarySearch(event.target.value)
                })
              }
              placeholder="Search titles, package names, genres…"
            />
          </label>

          <div className="library-meta">
            <span>{manifest.games.length} titles</span>
            <span>{assetFiles.length} imported files</span>
          </div>

          <div className="game-grid">
            {visibleGames.map((game, index) => {
              const resolved = resolveGameAssets(game, assetFiles)
              const presentCount =
                resolved.apks.filter((entry) => entry.file).length +
                resolved.obbs.filter((entry) => entry.file).length
              const totalCount = resolved.apks.length + resolved.obbs.length

              return (
                <button
                  key={game.id}
                    className={`game-card ${activeSelectedGameId === game.id ? 'selected' : ''}`}
                  style={{
                    animationDelay: `${index * 55}ms`,
                    ['--card-accent' as string]: game.accent || '#0f766e',
                  }}
                  onClick={() => setSelectedGameId(game.id)}
                >
                  <div className="game-card-banner">
                    <span>{game.packageName}</span>
                    <strong>{presentCount}/{totalCount} files ready</strong>
                  </div>
                  <div className="game-card-body">
                    <h3>{game.title}</h3>
                    <p>{game.developer || 'Unknown publisher'}</p>
                    <p className="game-card-description">{game.description}</p>
                    <div className="tag-row">
                      {(game.genres ?? []).map((genre) => (
                        <span key={genre} className="tag-pill">
                          {genre}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        <section className="panel install-panel">
          <div className="panel-head">
            <div>
              <p className="panel-label">Install</p>
              <h2>{selectedGame ? selectedGame.title : 'Install deck'}</h2>
            </div>
          </div>

          {selectedGame && selectedGameAssets ? (
            <>
              <article
                className="selected-game"
                style={{
                  ['--selected-accent' as string]: selectedGame.accent || '#0f766e',
                }}
              >
                <div className="selected-game-banner">
                  <p>{selectedGame.developer || 'Independent build'}</p>
                  <strong>{selectedGame.packageName}</strong>
                </div>
                <p>{selectedGame.description}</p>
                {selectedGame.notes ? <p className="muted-copy">{selectedGame.notes}</p> : null}
              </article>

              <div className="asset-checklist">
                <div className="panel-subhead">
                  <h3>Resolved assets</h3>
                  <span>{selectedGameAssets.missingRequired.length === 0 ? 'Ready' : 'Missing files'}</span>
                </div>
                {[...selectedGameAssets.apks, ...selectedGameAssets.obbs].map((entry) => (
                  <article key={entry.spec.fileName} className={`asset-row ${entry.file ? 'ready' : 'missing'}`}>
                    <div>
                      <strong>{entry.spec.label || entry.spec.fileName}</strong>
                      <p>{entry.file ? `${entry.file.name} · ${formatBytes(entry.file.size)}` : 'Not imported yet'}</p>
                    </div>
                    <span>{entry.file ? 'Ready' : entry.spec.optional ? 'Optional' : 'Required'}</span>
                  </article>
                ))}
              </div>

              <button
                className="button-primary full-width"
                onClick={() => void handleInstallSelectedGame()}
                disabled={!bridge || isInstalling || selectedGameAssets.missingRequired.length > 0}
              >
                {isInstalling ? 'Installing…' : `Install ${selectedGame.title}`}
              </button>
            </>
          ) : (
            <div className="empty-state">
              <strong>No title selected</strong>
              <p>Pick a manifest entry to inspect its files and install it onto the headset.</p>
            </div>
          )}

          <div className="panel-subsection">
            <div className="panel-subhead">
              <h3>Quick Install</h3>
              <span>Manual</span>
            </div>

            <p className="muted-copy">
              Use this when you just want to push files without preparing a manifest first.
            </p>

            <label className="search-field">
              <span>Package name for OBB uploads</span>
              <input
                type="text"
                value={manualPackageName}
                onChange={(event) => setManualPackageName(event.target.value)}
                placeholder="com.example.mygame"
              />
            </label>

            <div className="toolbar">
              <button className="button-ghost" onClick={() => manualApkInputRef.current?.click()}>
                Choose APKs
              </button>
              <button className="button-ghost" onClick={() => manualObbInputRef.current?.click()}>
                Choose OBBs
              </button>
              <button
                className="button-ghost"
                onClick={() => {
                  setManualApkFiles([])
                  setManualObbFiles([])
                }}
                disabled={manualApkFiles.length === 0 && manualObbFiles.length === 0}
              >
                Clear files
              </button>
            </div>

            <div className="file-chip-list">
              {manualApkFiles.map((file) => (
                <span key={`${file.name}:${file.size}`} className="file-chip">
                  APK · {file.name}
                </span>
              ))}
              {manualObbFiles.map((file) => (
                <span key={`${file.name}:${file.size}`} className="file-chip">
                  OBB · {file.name}
                </span>
              ))}
              {manualApkFiles.length === 0 && manualObbFiles.length === 0 ? (
                <p className="muted-copy">No manual files selected yet.</p>
              ) : null}
            </div>

            <button
              className="button-primary full-width"
              onClick={() => void handleManualInstall()}
              disabled={!bridge || isInstalling || manualApkFiles.length === 0}
            >
              {isInstalling ? 'Installing…' : 'Install selected files'}
            </button>
          </div>
        </section>
      </section>

      <section className="panel activity-panel">
        <div className="panel-head">
          <div>
            <p className="panel-label">Activity</p>
            <h2>{installProgress.label}</h2>
          </div>
          <span className={`phase-pill phase-${installProgress.phase}`}>{installProgress.phase}</span>
        </div>

        <div className="progress-card">
          <div className="progress-copy">
            <strong>{installProgress.detail}</strong>
            <span>{typeof installProgress.percent === 'number' ? `${installProgress.percent}%` : 'Awaiting action'}</span>
          </div>
          <div className="progress-track" aria-hidden="true">
            <div
              className="progress-bar"
              style={{ width: `${typeof installProgress.percent === 'number' ? installProgress.percent : 0}%` }}
            />
          </div>
        </div>

        <div className="activity-list">
          {activity.map((entry) => (
            <article key={entry.id} className={`activity-row activity-${entry.level}`}>
              <span>{entry.timestamp}</span>
              <strong>{entry.message}</strong>
            </article>
          ))}
        </div>
      </section>

      <input
        ref={manifestInputRef}
        className="visually-hidden"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          void handleManifestImport(event)
        }}
      />
      <input
        ref={assetInputRef}
        className="visually-hidden"
        type="file"
        multiple
        accept=".apk,.obb"
        onChange={handleAssetImport}
      />
      <input
        ref={manualApkInputRef}
        className="visually-hidden"
        type="file"
        multiple
        accept=".apk"
        onChange={handleManualApkImport}
      />
      <input
        ref={manualObbInputRef}
        className="visually-hidden"
        type="file"
        multiple
        accept=".obb"
        onChange={handleManualObbImport}
      />
    </div>
  )
}

export default App
