import { execFile as execFileCallback } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import crypto from 'node:crypto'

const execFile = promisify(execFileCallback)

function requiredEnv(name) {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

function decodePassword() {
  const plain = process.env.CATALOG_PASSWORD?.trim()

  if (plain) {
    return plain
  }

  const encoded = requiredEnv('CATALOG_PASSWORD_B64')
  return Buffer.from(encoded, 'base64').toString('utf8')
}

function normalizeBaseUri(value) {
  return value.endsWith('/') ? value : `${value}/`
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function ensureDirectory(path) {
  await mkdir(path, { recursive: true })
}

async function downloadFile(url, destinationPath) {
  const response = await fetch(url, {
    headers: {
      'user-agent': process.env.CATALOG_USER_AGENT || 'QuestLibraryCatalogBot/1.0',
      accept: '*/*',
    },
  })

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(destinationPath))
}

async function extractArchive(archivePath, destinationPath, password) {
  await execFile(
    '7z',
    ['x', '-y', `-p${password}`, archivePath, `-o${destinationPath}`],
    {
      maxBuffer: 32 * 1024 * 1024,
    },
  )
}

async function listPathsRecursive(rootPath) {
  const entries = await readdir(rootPath, { withFileTypes: true })
  const output = []

  for (const entry of entries) {
    const nextPath = join(rootPath, entry.name)
    output.push(nextPath)

    if (entry.isDirectory()) {
      output.push(...(await listPathsRecursive(nextPath)))
    }
  }

  return output
}

async function findFirstPath(rootPath, matcher) {
  const allPaths = await listPathsRecursive(rootPath)
  return allPaths.find((entry) => matcher(entry)) || null
}

function parseDelimitedValue(parts, index, fallback = '') {
  return index >= 0 ? parts[index]?.trim() || fallback : fallback
}

function buildReleaseToken(releaseName) {
  return crypto.createHash('md5').update(`${releaseName}\n`).digest('hex')
}

function parseGameList(data, notesDir, thumbnailSet) {
  const lines = data.split(/\r?\n/)
  const headerLine = lines[0]

  if (!headerLine || !headerLine.includes(';')) {
    throw new Error('Invalid game list header format.')
  }

  const columns = headerLine.split(';').map((value) => value.trim())
  const gameNameIndex = columns.indexOf('Game Name')
  const packageNameIndex = columns.indexOf('Package Name')
  const versionCodeIndex = columns.indexOf('Version Code')
  const sizeIndex = columns.indexOf('Size (MB)')
  const lastUpdatedIndex = columns.indexOf('Last Updated')
  const releaseNameIndex = columns.indexOf('Release Name')
  const downloadsIndex = columns.indexOf('Downloads')

  const games = []

  for (const rawLine of lines.slice(1)) {
    const line = rawLine.trim()

    if (!line) {
      continue
    }

    const parts = line.split(';')
    const title = parseDelimitedValue(parts, gameNameIndex, 'Unknown')
    const packageName = parseDelimitedValue(parts, packageNameIndex)
    const versionCode = parseDelimitedValue(parts, versionCodeIndex)
    const sizeMbRaw = parseDelimitedValue(parts, sizeIndex)
    const lastUpdated = parseDelimitedValue(parts, lastUpdatedIndex)
    const releaseName = parseDelimitedValue(parts, releaseNameIndex)
    const downloadsRaw = parseDelimitedValue(parts, downloadsIndex, '0')

    if (!title || title === 'Unknown' || !packageName || !releaseName) {
      continue
    }

    const notePath = join(notesDir, `${releaseName}.txt`)

    games.push({
      id: packageName,
      title,
      packageName,
      versionCode,
      sizeLabel: sizeMbRaw ? `${sizeMbRaw} MB` : '',
      sizeMb: Number.parseFloat(sizeMbRaw) || 0,
      lastUpdated,
      releaseName,
      releaseToken: buildReleaseToken(releaseName),
      downloads: Number.parseFloat(downloadsRaw) || 0,
      notePath,
      hasThumbnail: thumbnailSet.has(`${packageName}.jpg`),
    })
  }

  return games
}

async function hydrateNotes(games) {
  let noteCount = 0

  for (const game of games) {
    if (await pathExists(game.notePath)) {
      const note = (await readFile(game.notePath, 'utf8')).trim()

      if (note) {
        game.note = note
        noteCount += 1
      }
    }

    delete game.notePath
  }

  return noteCount
}

async function main() {
  const baseUri = normalizeBaseUri(requiredEnv('CATALOG_BASE_URI'))
  const password = decodePassword()
  const outputPath = resolve(
    process.env.CATALOG_OUTPUT_PATH || join(process.cwd(), 'public', 'remote-catalog.json'),
  )

  const tempRoot = await mkdtemp(join(tmpdir(), 'quest-library-catalog-'))
  const archivePath = join(tempRoot, 'meta.7z')
  const extractPath = join(tempRoot, 'meta')

  try {
    await ensureDirectory(dirname(outputPath))

    console.log(`Downloading catalog archive from ${new URL('meta.7z', baseUri).toString()}`)
    await downloadFile(new URL('meta.7z', baseUri).toString(), archivePath)

    console.log('Extracting catalog archive')
    await extractArchive(archivePath, extractPath, password)

    const gameListPath = await findFirstPath(extractPath, (entry) => /amelist\.txt$/i.test(entry))

    if (!gameListPath) {
      throw new Error('Unable to locate the extracted game list file.')
    }

    const metaDir =
      (await findFirstPath(extractPath, (entry) => basename(entry) === '.meta')) ||
      join(extractPath, '.meta')
    const notesDir = join(metaDir, 'notes')
    const thumbnailsDir = join(metaDir, 'thumbnails')
    const thumbnailSet = new Set(
      (await pathExists(thumbnailsDir)) ? await readdir(thumbnailsDir) : [],
    )

    console.log(`Parsing game list from ${gameListPath}`)
    const gameListData = await readFile(gameListPath, 'utf8')
    const games = parseGameList(gameListData, notesDir, thumbnailSet)
    const noteCount = await hydrateNotes(games)

    games.sort((left, right) => {
      if (right.downloads !== left.downloads) {
        return right.downloads - left.downloads
      }

      return left.title.localeCompare(right.title)
    })

    const catalog = {
      generatedAt: new Date().toISOString(),
      source: {
        baseUriHost: new URL(baseUri).host,
        gameListFile: gameListPath ? basename(gameListPath) : null,
      },
      stats: {
        totalGames: games.length,
        noteCount,
        thumbnailCount: thumbnailSet.size,
      },
      games,
    }

    await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
    console.log(`Wrote ${games.length} catalog entries to ${outputPath}`)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
