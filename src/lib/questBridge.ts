import { Adb, AdbDaemonTransport } from '@yume-chan/adb'
import { AdbDaemonWebUsbDevice, AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb'
import { PackageManager } from '@yume-chan/android-bin'
import type { MaybeConsumable, ReadableStream as AdbReadableStream } from '@yume-chan/stream-extra'

import type {
  BundleObbFile,
  DeviceSummary,
  InstallBundle,
  InstalledPackageInfo,
  InstallProgressHandler,
} from '../types'
import { browserCredentialStore } from './adbCredentialStore'

function basenameToSafeRemoteName(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, '_')
}

function unixDirname(path: string): string {
  const normalized = path.replaceAll(/\/+/g, '/')
  const index = normalized.lastIndexOf('/')

  if (index <= 0) {
    return '/'
  }

  return normalized.slice(0, index)
}

function createProgressStream(
  file: File,
  onProgress: (percent: number) => void,
): AdbReadableStream<MaybeConsumable<Uint8Array>> {
  const reader = file.stream().getReader()
  let uploaded = 0
  const total = Math.max(file.size, 1)

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await reader.read()

      if (next.done) {
        onProgress(100)
        controller.close()
        return
      }

      uploaded += next.value.byteLength
      onProgress(Math.min(100, Math.round((uploaded / total) * 100)))
      controller.enqueue(next.value)
    },
    async cancel(reason) {
      await reader.cancel(reason)
    },
  }) as unknown as AdbReadableStream<MaybeConsumable<Uint8Array>>
}

async function removeRemotePath(adb: Adb, path: string): Promise<void> {
  try {
    await adb.rm(path, { recursive: true, force: true })
  } catch {
    // Cleanup is best effort.
  }
}

export class QuestBridge {
  static isSupported(): boolean {
    return Boolean(AdbDaemonWebUsbDeviceManager.BROWSER && window.isSecureContext)
  }

  static async connect(): Promise<QuestBridge> {
    const manager = AdbDaemonWebUsbDeviceManager.BROWSER

    if (!manager) {
      throw new Error('WebUSB is not available in this browser. Use a secure Chromium-based browser.')
    }

    const grantedDevices = await manager.getDevices()
    const usbDevice = grantedDevices[0] ?? (await manager.requestDevice())

    if (!usbDevice) {
      throw new Error('No USB debugging device was selected.')
    }

    const connection = await usbDevice.connect()
    const transport = await AdbDaemonTransport.authenticate({
      serial: usbDevice.serial || usbDevice.name || 'quest-webusb',
      connection,
      credentialStore: browserCredentialStore,
    })

    return new QuestBridge(usbDevice, new Adb(transport))
  }

  readonly usbDevice: AdbDaemonWebUsbDevice
  readonly adb: Adb

  constructor(usbDevice: AdbDaemonWebUsbDevice, adb: Adb) {
    this.usbDevice = usbDevice
    this.adb = adb
  }

  get disconnected(): Promise<void> {
    return this.adb.disconnected
  }

  async disconnect(): Promise<void> {
    await this.adb.close()
  }

  private async ensureDirectory(path: string): Promise<void> {
    await this.adb.subprocess.noneProtocol.spawnWaitText(['mkdir', '-p', path])
  }

  async getDeviceSummary(): Promise<DeviceSummary> {
    const [manufacturer, model, product, device, androidVersion, sdk] = await Promise.all([
      this.adb.getProp('ro.product.manufacturer'),
      this.adb.getProp('ro.product.model'),
      this.adb.getProp('ro.product.name'),
      this.adb.getProp('ro.product.device'),
      this.adb.getProp('ro.build.version.release'),
      this.adb.getProp('ro.build.version.sdk'),
    ])

    const summaryName = [manufacturer, model].filter(Boolean).join(' ').trim()

    return {
      serial: this.usbDevice.serial || this.adb.serial || 'unknown',
      name: summaryName || this.usbDevice.name || 'Meta Quest',
      manufacturer,
      model,
      product,
      device,
      androidVersion,
      sdk,
    }
  }

  async listInstalledPackages(): Promise<InstalledPackageInfo[]> {
    const pm = new PackageManager(this.adb)
    const packages: InstalledPackageInfo[] = []

    for await (const entry of pm.listPackages({
      listThirdParty: true,
      showInstaller: true,
      showSourceDir: true,
      showVersionCode: true,
    })) {
      packages.push({
        packageName: entry.packageName,
        installer: entry.installer,
        sourceDir: entry.sourceDir,
        versionCode: entry.versionCode,
      })
    }

    return packages.sort((left, right) => left.packageName.localeCompare(right.packageName))
  }

  private async uploadFile(
    targetPath: string,
    file: File,
    label: string,
    onProgress: InstallProgressHandler,
    phase: 'uploading-apk' | 'uploading-obb',
  ): Promise<void> {
    const sync = await this.adb.sync()

    try {
      await sync.write({
        filename: targetPath,
        file: createProgressStream(file, (percent) =>
          onProgress({
            phase,
            percent,
            label,
            detail: `Uploading ${file.name}`,
          }),
        ),
      })
    } finally {
      await sync.dispose()
    }
  }

  private async installApks(bundle: InstallBundle, onProgress: InstallProgressHandler): Promise<void> {
    const pm = new PackageManager(this.adb)

    if (bundle.apkFiles.length === 1) {
      const [apk] = bundle.apkFiles
      onProgress({
        phase: 'uploading-apk',
        percent: 0,
        label: bundle.label,
        detail: `Streaming ${apk.name}`,
      })

      await pm.installStream(
        apk.size,
        createProgressStream(apk, (percent) =>
          onProgress({
            phase: 'uploading-apk',
            percent,
            label: bundle.label,
            detail: `Streaming ${apk.name}`,
          }),
        ),
        {
          grantRuntimePermissions: true,
        },
      )

      onProgress({
        phase: 'installing-apk',
        percent: 100,
        label: bundle.label,
        detail: `Installed ${apk.name}`,
      })
      return
    }

    const remoteDir = `/data/local/tmp/quest-library-${Date.now()}`
    const remotePaths: string[] = []

    await this.ensureDirectory(remoteDir)

    try {
      for (const apk of bundle.apkFiles) {
        const remotePath = `${remoteDir}/${basenameToSafeRemoteName(apk.name)}`
        await this.uploadFile(remotePath, apk, bundle.label, onProgress, 'uploading-apk')
        remotePaths.push(remotePath)
      }

      onProgress({
        phase: 'installing-apk',
        percent: 100,
        label: bundle.label,
        detail: `Installing ${bundle.apkFiles.length} APK splits`,
      })

      await pm.install(remotePaths, {
        grantRuntimePermissions: true,
      })
    } finally {
      for (const remotePath of remotePaths) {
        await removeRemotePath(this.adb, remotePath)
      }
      await removeRemotePath(this.adb, remoteDir)
    }
  }

  private async uploadObbFiles(
    packageName: string | undefined,
    obbFiles: BundleObbFile[],
    label: string,
    onProgress: InstallProgressHandler,
  ): Promise<void> {
    if (obbFiles.length === 0) {
      return
    }

    if (!packageName) {
      throw new Error('A package name is required when pushing OBB files.')
    }

    for (const obb of obbFiles) {
      const targetPath = obb.targetPath || `/sdcard/Android/obb/${packageName}/${obb.file.name}`
      await this.ensureDirectory(unixDirname(targetPath))
      await this.uploadFile(targetPath, obb.file, label, onProgress, 'uploading-obb')
    }
  }

  async installBundle(bundle: InstallBundle, onProgress: InstallProgressHandler): Promise<void> {
    if (bundle.apkFiles.length === 0) {
      throw new Error('Select at least one APK before starting an install.')
    }

    try {
      await this.installApks(bundle, onProgress)
      await this.uploadObbFiles(bundle.packageName, bundle.obbFiles, bundle.label, onProgress)
      onProgress({
        phase: 'complete',
        percent: 100,
        label: bundle.label,
        detail: 'Install finished successfully.',
      })
    } catch (error) {
      onProgress({
        phase: 'error',
        label: bundle.label,
        detail: error instanceof Error ? error.message : 'Unknown install error',
      })
      throw error
    }
  }
}
