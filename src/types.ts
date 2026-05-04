export interface ManifestFileSpec {
  fileName: string
  label?: string
  optional?: boolean
}

export interface ManifestObbSpec extends ManifestFileSpec {
  targetPath?: string
}

export interface LibraryGame {
  id: string
  title: string
  packageName: string
  developer?: string
  description: string
  notes?: string
  releaseNotes?: string
  accent?: string
  genres?: string[]
  apks: ManifestFileSpec[]
  obbs?: ManifestObbSpec[]
}

export interface LibraryManifest {
  version: 1
  title: string
  description?: string
  ownershipStatement?: string
  games: LibraryGame[]
}

export interface RemoteCatalogGame {
  id: string
  title: string
  packageName: string
  versionCode: string
  sizeLabel: string
  sizeMb: number
  lastUpdated: string
  releaseName: string
  releaseToken: string
  downloads: number
  note?: string
  hasThumbnail: boolean
}


export interface RemoteCatalogSourceConfig {
  baseUri: string
  password: string
}

export interface RemoteCatalog {
  generatedAt: string | null
  source: {
    baseUriHost: string
    gameListFile: string | null
  }
  stats: {
    totalGames: number
    noteCount: number
    thumbnailCount: number
  }
  games: RemoteCatalogGame[]
}

export interface ResolvedManifestAsset<TSpec extends ManifestFileSpec = ManifestFileSpec> {
  spec: TSpec
  file?: File
}

export interface ResolvedGameAssets {
  apks: ResolvedManifestAsset[]
  obbs: ResolvedManifestAsset<ManifestObbSpec>[]
  missingRequired: string[]
}

export interface DeviceSummary {
  serial: string
  name: string
  manufacturer: string
  model: string
  product: string
  device: string
  androidVersion: string
  sdk: string
}

export interface InstalledPackageInfo {
  packageName: string
  installer?: string
  sourceDir?: string
  versionCode?: number
}

export type ActivityLevel = 'info' | 'success' | 'warning' | 'error'

export interface ActivityEntry {
  id: string
  level: ActivityLevel
  message: string
  timestamp: string
}

export type InstallPhase =
  | 'idle'
  | 'uploading-apk'
  | 'installing-apk'
  | 'uploading-obb'
  | 'complete'
  | 'error'

export interface InstallProgressSnapshot {
  phase: InstallPhase
  label: string
  detail?: string
  percent?: number
}

export interface BundleObbFile {
  file: File
  targetPath: string
}

export interface InstallBundle {
  label: string
  packageName?: string
  apkFiles: File[]
  obbFiles: BundleObbFile[]
}

export type InstallProgressHandler = (snapshot: InstallProgressSnapshot) => void
