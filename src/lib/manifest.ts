import type {
  LibraryGame,
  LibraryManifest,
  ManifestFileSpec,
  ManifestObbSpec,
  ResolvedGameAssets,
} from '../types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} must be a non-empty string.`)
  }

  return value.trim()
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)

  return normalized.length > 0 ? normalized : undefined
}

function parseFileSpecs(
  value: unknown,
  fieldName: string,
  allowTargetPath: boolean,
): ManifestFileSpec[] | ManifestObbSpec[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty array.`)
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`${fieldName}[${index}] must be an object.`)
    }

    const fileName = readRequiredString(entry.fileName, `${fieldName}[${index}].fileName`)
    const label = readOptionalString(entry.label)
    const optional = entry.optional === true

    if (!allowTargetPath) {
      return { fileName, label, optional }
    }

    return {
      fileName,
      label,
      optional,
      targetPath: readOptionalString(entry.targetPath),
    }
  })
}

function parseGame(entry: unknown, index: number): LibraryGame {
  if (!isRecord(entry)) {
    throw new Error(`games[${index}] must be an object.`)
  }

  return {
    id: readRequiredString(entry.id, `games[${index}].id`),
    title: readRequiredString(entry.title, `games[${index}].title`),
    packageName: readRequiredString(entry.packageName, `games[${index}].packageName`),
    developer: readOptionalString(entry.developer),
    description: readRequiredString(entry.description, `games[${index}].description`),
    notes: readOptionalString(entry.notes),
    releaseNotes: readOptionalString(entry.releaseNotes),
    accent: readOptionalString(entry.accent),
    genres: readOptionalStringArray(entry.genres),
    apks: parseFileSpecs(entry.apks, `games[${index}].apks`, false) as ManifestFileSpec[],
    obbs: entry.obbs
      ? (parseFileSpecs(entry.obbs, `games[${index}].obbs`, true) as ManifestObbSpec[])
      : undefined,
  }
}

export function parseLibraryManifest(jsonText: string): LibraryManifest {
  let parsed: unknown

  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error('Manifest is not valid JSON.')
  }

  if (!isRecord(parsed)) {
    throw new Error('Manifest root must be an object.')
  }

  if (parsed.version !== 1) {
    throw new Error('Only manifest version 1 is supported right now.')
  }

  if (!Array.isArray(parsed.games) || parsed.games.length === 0) {
    throw new Error('Manifest must include at least one game entry.')
  }

  return {
    version: 1,
    title: readRequiredString(parsed.title, 'title'),
    description: readOptionalString(parsed.description),
    ownershipStatement: readOptionalString(parsed.ownershipStatement),
    games: parsed.games.map((entry, index) => parseGame(entry, index)),
  }
}

function fileFingerprint(file: File): string {
  return [file.name, file.size, file.lastModified].join(':')
}

export function dedupeFiles(existing: File[], incoming: File[]): File[] {
  const byFingerprint = new Map(existing.map((file) => [fileFingerprint(file), file]))

  for (const file of incoming) {
    byFingerprint.set(fileFingerprint(file), file)
  }

  return [...byFingerprint.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export function resolveGameAssets(game: LibraryGame, files: File[]): ResolvedGameAssets {
  const byName = new Map(files.map((file) => [file.name.toLowerCase(), file]))
  const apks = game.apks.map((spec) => ({
    spec,
    file: byName.get(spec.fileName.toLowerCase()),
  }))
  const obbs = (game.obbs ?? []).map((spec) => ({
    spec,
    file: byName.get(spec.fileName.toLowerCase()),
  }))

  const missingRequired = [...apks, ...obbs]
    .filter((entry) => !entry.file && !entry.spec.optional)
    .map((entry) => entry.spec.fileName)

  return { apks, obbs, missingRequired }
}
