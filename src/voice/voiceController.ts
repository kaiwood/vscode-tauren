import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import * as vscode from 'vscode';
import { defaultVoiceModelId, getVoiceBinaryAsset, getVoiceModelAsset, voiceModelAssets } from './voiceAssetCatalog';
import type { VoiceAssetDownloadState, VoiceInputDevice, VoiceModelId, VoiceState, VoiceTranscriptAction } from './types';
import { getVoiceEnabledSetting, getVoiceInputDeviceSetting, getVoiceModelSetting, getVoiceTranscriptActionSetting } from '../settings/taurenSettings';
import { getErrorMessage } from '../controller/errors';

const voiceStorageDirectoryName = 'voice';
const modelsDirectoryName = 'models';
const runtimeDirectoryName = 'runtime';
const downloadsDirectoryName = 'downloads';

export type VoiceControllerOptions = {
  storageUri: vscode.Uri | undefined;
  onDidChangeState: () => void;
  onTranscript: (text: string, action: VoiceTranscriptAction) => Promise<void> | void;
  showNotification: (message: string, notifyType: string) => void;
  showToast?: (message: string, kind?: 'success' | 'warning' | 'error') => void;
};

type ActiveRecording = {
  process: ChildProcess;
  audioFile: string;
};

export class VoiceController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly modelDownloads = new Map<VoiceModelId, VoiceAssetDownloadState>();
  private binaryDownload: VoiceAssetDownloadState = { status: 'idle' };
  private inputDevicesStatus: VoiceState['inputDevices']['status'] = 'idle';
  private inputDevices: VoiceInputDevice[] = [{ id: 'default', label: 'Default microphone', isDefault: true }];
  private inputDevicesError: string | undefined;
  private activeRecording: ActiveRecording | undefined;
  private recordingStatus: VoiceState['recordingStatus'] = 'idle';
  private lastError: string | undefined;

  public constructor(private readonly options: VoiceControllerOptions) {}

  public dispose(): void {
    void this.stopRecorderProcess();
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  public getState(): VoiceState {
    const selectedModelId = getVoiceModelSetting();
    const binaryAsset = getVoiceBinaryAsset();
    const downloadedBinaryPath = binaryAsset ? this.getBinaryExecutablePath(binaryAsset.executableName) : undefined;
    const downloadedBinaryAvailable = downloadedBinaryPath ? fileExistsSync(downloadedBinaryPath) : false;
    const systemBinaryPath = findSystemWhisperCliSync();
    const binaryPath = downloadedBinaryAvailable ? downloadedBinaryPath : systemBinaryPath;
    const binaryAvailable = Boolean(binaryPath);

    return {
      enabled: getVoiceEnabledSetting(),
      selectedModelId,
      transcriptAction: getVoiceTranscriptActionSetting(),
      models: voiceModelAssets.map((model) => {
        const downloaded = fileExistsSync(this.getModelPath(model.id));
        return {
          id: model.id,
          label: model.label,
          description: model.description,
          sizeBytes: model.sizeBytes,
          downloaded,
          download: downloaded ? { status: 'downloaded' } : this.modelDownloads.get(model.id) ?? { status: 'idle' }
        };
      }),
      binary: {
        status: binaryAvailable ? 'downloaded' : binaryAsset ? this.binaryDownload.status : 'unavailable',
        label: binaryAvailable
          ? systemBinaryPath && !downloadedBinaryAvailable ? 'System whisper.cpp runtime' : binaryAsset?.label ?? 'whisper.cpp runtime'
          : binaryAsset?.label ?? `No curated whisper.cpp binary for ${process.platform}/${process.arch}`,
        ...(binaryPath ? { path: binaryPath } : {}),
        ...(systemBinaryPath && !downloadedBinaryAvailable ? { source: 'system' as const } : binaryAvailable ? { source: 'downloaded' as const } : {}),
        ...(!binaryAvailable && !binaryAsset ? { helper: getSystemWhisperInstallHint() } : {}),
        download: binaryAvailable ? { status: 'downloaded' } : binaryAsset ? this.binaryDownload : { status: 'unavailable', error: getSystemWhisperInstallHint() }
      },
      inputDevices: {
        selectedId: getVoiceInputDeviceSetting(),
        status: this.inputDevicesStatus,
        devices: this.getInputDevicesForState(),
        ...(this.inputDevicesError ? { error: this.inputDevicesError } : {})
      },
      recordingStatus: this.recordingStatus,
      ...(this.lastError ? { error: this.lastError } : {})
    };
  }

  public async downloadSelectedModel(): Promise<void> {
    await this.downloadModel(getVoiceModelSetting());
  }

  public async downloadModel(modelId: string): Promise<void> {
    const model = getVoiceModelAsset(modelId);
    if (!model) {
      throw new Error(`Unknown voice model: ${modelId}`);
    }

    if (this.modelDownloads.get(model.id)?.status === 'downloading') {
      return;
    }

    const target = this.getModelPath(model.id);
    if (await fileExists(target)) {
      this.modelDownloads.set(model.id, { status: 'downloaded' });
      this.options.onDidChangeState();
      return;
    }

    await this.ensureStorageReady();
    await this.downloadFile(model.url, target, {
      state: (state) => this.modelDownloads.set(model.id, state),
      onProgress: () => this.options.onDidChangeState(),
      expectedSha1: model.sha1
    });
  }

  public async deleteModel(modelId: string): Promise<void> {
    const model = getVoiceModelAsset(modelId);
    if (!model) {
      return;
    }

    await fs.rm(this.getModelPath(model.id), { force: true });
    this.modelDownloads.delete(model.id);
    this.options.onDidChangeState();
  }

  public async downloadBinary(): Promise<void> {
    const asset = getVoiceBinaryAsset();
    if (!asset) {
      this.binaryDownload = { status: 'unavailable', error: 'No curated binary is configured for this platform yet.' };
      this.options.onDidChangeState();
      return;
    }

    if (this.binaryDownload.status === 'downloading') {
      return;
    }

    const executablePath = this.getBinaryExecutablePath(asset.executableName);
    if (await fileExists(executablePath)) {
      this.binaryDownload = { status: 'downloaded' };
      this.options.onDidChangeState();
      return;
    }

    await this.ensureStorageReady();
    const archivePath = path.join(this.getDownloadsDirectory(), asset.fileName);

    await this.downloadFile(asset.url, archivePath, {
      state: (state) => { this.binaryDownload = state; },
      onProgress: () => this.options.onDidChangeState()
    });

    this.binaryDownload = { status: 'downloading' };
    this.options.onDidChangeState();
    try {
      await fs.rm(this.getRuntimeDirectory(), { recursive: true, force: true });
      await fs.mkdir(this.getRuntimeDirectory(), { recursive: true });
      await extractZip(archivePath, this.getRuntimeDirectory());
      const extractedExecutable = await findFile(this.getRuntimeDirectory(), asset.executableName);
      if (!extractedExecutable) {
        throw new Error(`Downloaded archive did not contain ${asset.executableName}.`);
      }
      await fs.mkdir(path.dirname(executablePath), { recursive: true });
      await fs.copyFile(extractedExecutable, executablePath);
      await fs.chmod(executablePath, 0o755).catch(() => undefined);
      this.binaryDownload = { status: 'downloaded' };
    } catch (error) {
      this.binaryDownload = { status: 'failed', error: getErrorMessage(error) };
      throw error;
    } finally {
      this.options.onDidChangeState();
    }
  }

  public async refreshInputDevices(): Promise<void> {
    if (this.inputDevicesStatus === 'refreshing') {
      return;
    }

    this.inputDevicesStatus = 'refreshing';
    this.inputDevicesError = undefined;
    this.options.onDidChangeState();

    try {
      this.inputDevices = await listInputDevices();
      this.inputDevicesStatus = 'ready';
    } catch (error) {
      this.inputDevices = [{ id: 'default', label: 'Default microphone', isDefault: true }];
      this.inputDevicesStatus = 'error';
      this.inputDevicesError = getErrorMessage(error);
    } finally {
      this.options.onDidChangeState();
    }
  }

  public async startRecording(): Promise<void> {
    if (this.activeRecording || this.recordingStatus === 'recording' || this.recordingStatus === 'transcribing') {
      return;
    }

    if (!getVoiceEnabledSetting()) {
      return;
    }

    this.lastError = undefined;
    const readinessError = await this.getReadinessError();
    if (readinessError) {
      this.lastError = readinessError;
      this.recordingStatus = 'error';
      this.options.onDidChangeState();
      this.options.showNotification(readinessError, 'warning');
      return;
    }

    const audioFile = path.join(os.tmpdir(), `tauren-voice-${Date.now()}.wav`);
    const command = getFfmpegRecordingCommand(audioFile, getVoiceInputDeviceSetting());
    const recorder = spawn(command.executable, command.args, { stdio: ['ignore', 'pipe', 'pipe'] });

    recorder.on('error', (error) => {
      this.activeRecording = undefined;
      this.recordingStatus = 'error';
      this.lastError = getErrorMessage(error);
      this.options.onDidChangeState();
    });

    this.activeRecording = { process: recorder, audioFile };
    this.recordingStatus = 'recording';
    this.options.onDidChangeState();
  }

  public async stopRecording(): Promise<void> {
    const recording = this.activeRecording;
    if (!recording) {
      return;
    }

    this.activeRecording = undefined;
    this.recordingStatus = 'transcribing';
    this.options.onDidChangeState();

    try {
      await stopProcess(recording.process);
      const transcript = await this.transcribe(recording.audioFile);
      this.recordingStatus = 'idle';
      this.lastError = undefined;
      this.options.onDidChangeState();

      if (transcript.trim()) {
        const action = getVoiceTranscriptActionSetting();
        await this.options.onTranscript(transcript.trim(), action);
      } else {
        this.options.showNotification('No speech was detected.', 'warning');
      }
    } catch (error) {
      this.recordingStatus = 'error';
      this.lastError = getErrorMessage(error);
      this.options.onDidChangeState();
      this.options.showNotification(`Voice transcription failed: ${this.lastError}`, 'warning');
    } finally {
      await fs.rm(recording.audioFile, { force: true }).catch(() => undefined);
    }
  }

  private async transcribe(audioFile: string): Promise<string> {
    const executable = await this.resolveWhisperExecutable();
    if (!executable) {
      throw new Error(`Install whisper.cpp before using voice input. ${getSystemWhisperInstallHint()}`);
    }

    const model = this.getModelPath(getVoiceModelSetting());
    const args = ['-m', model, '-f', audioFile, '-nt'];

    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve(cleanWhisperOutput(stdout));
        } else {
          reject(new Error(stderr.trim() || `whisper.cpp exited with code ${code}.`));
        }
      });
    });
  }

  private async getReadinessError(): Promise<string | undefined> {
    if (!(await this.resolveWhisperExecutable())) {
      return `Install whisper.cpp before using voice input. ${getSystemWhisperInstallHint()}`;
    }

    if (!(await fileExists(this.getModelPath(getVoiceModelSetting())))) {
      return 'Download the selected voice model before using voice input.';
    }

    if (!(await commandExists('ffmpeg'))) {
      return 'Voice recording needs ffmpeg on PATH for this first implementation.';
    }

    return undefined;
  }

  private async resolveWhisperExecutable(): Promise<string | undefined> {
    const binaryAsset = getVoiceBinaryAsset();
    if (binaryAsset) {
      const downloadedBinaryPath = this.getBinaryExecutablePath(binaryAsset.executableName);
      if (await fileExists(downloadedBinaryPath)) {
        return downloadedBinaryPath;
      }
    }

    return findSystemWhisperCliSync();
  }

  private async stopRecorderProcess(): Promise<void> {
    const recording = this.activeRecording;
    if (!recording) {
      return;
    }

    this.activeRecording = undefined;
    await stopProcess(recording.process).catch(() => undefined);
    await fs.rm(recording.audioFile, { force: true }).catch(() => undefined);
  }

  private getInputDevicesForState(): VoiceInputDevice[] {
    const selectedId = getVoiceInputDeviceSetting();
    if (selectedId === 'default' || this.inputDevices.some((device) => device.id === selectedId)) {
      return this.inputDevices;
    }

    return [
      ...this.inputDevices,
      { id: selectedId, label: `Selected device (${selectedId})` }
    ];
  }

  private async downloadFile(
    url: string,
    target: string,
    options: {
      state: (state: VoiceAssetDownloadState) => void;
      onProgress: () => void;
      expectedSha1?: string;
    }
  ): Promise<void> {
    const partialTarget = `${target}.partial`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rm(partialTarget, { force: true });
    options.state({ status: 'downloading', receivedBytes: 0 });
    options.onProgress();

    try {
      await downloadHttpFile(url, partialTarget, (receivedBytes, totalBytes) => {
        options.state({ status: 'downloading', receivedBytes, ...(totalBytes ? { totalBytes } : {}) });
        options.onProgress();
      });

      if (options.expectedSha1) {
        const actualSha1 = await sha1File(partialTarget);
        if (actualSha1 !== options.expectedSha1) {
          throw new Error('Downloaded file checksum did not match the expected model checksum.');
        }
      }

      await fs.rename(partialTarget, target);
      options.state({ status: 'downloaded' });
    } catch (error) {
      await fs.rm(partialTarget, { force: true }).catch(() => undefined);
      options.state({ status: 'failed', error: getErrorMessage(error) });
      throw error;
    } finally {
      options.onProgress();
    }
  }

  private getModelPath(modelId: VoiceModelId): string {
    const asset = getVoiceModelAsset(modelId) ?? getVoiceModelAsset(defaultVoiceModelId)!;
    return path.join(this.getModelsDirectory(), asset.fileName);
  }

  private getBinaryExecutablePath(executableName: string): string {
    return path.join(this.getRuntimeDirectory(), 'bin', executableName);
  }

  private getVoiceDirectory(): string {
    const storagePath = this.options.storageUri?.fsPath ?? path.join(os.homedir(), '.tauren');
    return path.join(storagePath, voiceStorageDirectoryName);
  }

  private getModelsDirectory(): string {
    return path.join(this.getVoiceDirectory(), modelsDirectoryName);
  }

  private getRuntimeDirectory(): string {
    return path.join(this.getVoiceDirectory(), runtimeDirectoryName);
  }

  private getDownloadsDirectory(): string {
    return path.join(this.getVoiceDirectory(), downloadsDirectoryName);
  }

  private async ensureStorageReady(): Promise<void> {
    await fs.mkdir(this.getModelsDirectory(), { recursive: true });
    await fs.mkdir(this.getRuntimeDirectory(), { recursive: true });
    await fs.mkdir(this.getDownloadsDirectory(), { recursive: true });
  }
}

function findSystemWhisperCliSync(): string | undefined {
  return findExecutableSync('whisper-cli') ?? findExecutableSync('whisper-cpp');
}

function findExecutableSync(command: string): string | undefined {
  const pathValue = process.env.PATH ?? '';
  const pathEntries = pathValue.split(path.delimiter).filter(Boolean);
  const fallbackEntries = process.platform === 'darwin'
    ? ['/opt/homebrew/bin', '/usr/local/bin']
    : [];
  const executableNames = process.platform === 'win32' ? [`${command}.exe`, command] : [command];

  for (const directory of [...pathEntries, ...fallbackEntries]) {
    for (const executableName of executableNames) {
      const executablePath = path.join(directory, executableName);
      if (fileExistsSync(executablePath)) {
        return executablePath;
      }
    }
  }

  return undefined;
}

function getSystemWhisperInstallHint(): string {
  return process.platform === 'darwin'
    ? 'On macOS, install it with Homebrew: brew install whisper-cpp.'
    : 'Install whisper.cpp and ensure whisper-cli is available on PATH.';
}

function getFfmpegRecordingCommand(audioFile: string, inputDeviceId: string): { executable: string; args: string[] } {
  const deviceId = inputDeviceId || 'default';

  if (process.platform === 'darwin') {
    const input = deviceId === 'default' ? ':0' : `:${deviceId}`;
    return { executable: 'ffmpeg', args: ['-y', '-f', 'avfoundation', '-i', input, '-ar', '16000', '-ac', '1', audioFile] };
  }

  if (process.platform === 'win32') {
    const input = deviceId === 'default' ? 'audio=default' : `audio=${deviceId}`;
    return { executable: 'ffmpeg', args: ['-y', '-f', 'dshow', '-i', input, '-ar', '16000', '-ac', '1', audioFile] };
  }

  const input = deviceId === 'default' ? 'default' : deviceId;
  return { executable: 'ffmpeg', args: ['-y', '-f', 'pulse', '-i', input, '-ar', '16000', '-ac', '1', audioFile] };
}

async function listInputDevices(): Promise<VoiceInputDevice[]> {
  if (process.platform === 'darwin') {
    return listMacInputDevices();
  }

  if (process.platform === 'win32') {
    return listWindowsInputDevices();
  }

  return listLinuxInputDevices();
}

async function listMacInputDevices(): Promise<VoiceInputDevice[]> {
  const result = await runCommandWithOutput('ffmpeg', ['-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { allowFailure: true });
  const devices: VoiceInputDevice[] = [{ id: 'default', label: 'Default microphone', isDefault: true }];
  let inAudioSection = false;

  for (const line of result.stderr.split('\n')) {
    if (line.includes('AVFoundation audio devices:')) {
      inAudioSection = true;
      continue;
    }
    if (line.includes('AVFoundation video devices:')) {
      inAudioSection = false;
      continue;
    }
    if (!inAudioSection) {
      continue;
    }

    const match = line.match(/\[(\d+)\]\s+(.+)$/);
    if (match) {
      devices.push({ id: match[1], label: match[2].trim() });
    }
  }

  return devices;
}

async function listWindowsInputDevices(): Promise<VoiceInputDevice[]> {
  const result = await runCommandWithOutput('ffmpeg', ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { allowFailure: true });
  const devices: VoiceInputDevice[] = [{ id: 'default', label: 'Default microphone', isDefault: true }];
  let inAudioSection = false;

  for (const line of result.stderr.split('\n')) {
    if (line.includes('DirectShow audio devices')) {
      inAudioSection = true;
      continue;
    }
    if (line.includes('DirectShow video devices')) {
      inAudioSection = false;
      continue;
    }
    if (!inAudioSection) {
      continue;
    }

    const match = line.match(/"([^"]+)"/);
    if (match && !line.includes('Alternative name')) {
      devices.push({ id: match[1], label: match[1] });
    }
  }

  return devices;
}

async function listLinuxInputDevices(): Promise<VoiceInputDevice[]> {
  const devices: VoiceInputDevice[] = [{ id: 'default', label: 'Default microphone', isDefault: true }];
  const result = await runCommandWithOutput('pactl', ['list', 'short', 'sources']);

  for (const line of result.stdout.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      devices.push({ id: parts[1], label: parts[1] });
    }
  }

  return devices;
}

function cleanWhisperOutput(value: string): string {
  return value
    .split('\n')
    .map((line) => line.replace(/^\s*\[[^\]]+\]\s*/, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

async function downloadHttpFile(url: string, target: string, onProgress: (receivedBytes: number, totalBytes: number | undefined) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = (nextUrl: string, redirects = 0): void => {
      const client = nextUrl.startsWith('https:') ? https : http;
      const req = client.get(nextUrl, (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location && redirects < 5) {
          response.resume();
          request(new URL(response.headers.location, nextUrl).toString(), redirects + 1);
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Download failed with HTTP ${response.statusCode}.`));
          return;
        }

        const totalBytes = parseContentLength(response.headers['content-length']);
        let receivedBytes = 0;
        const file = require('node:fs').createWriteStream(target);
        response.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length;
          onProgress(receivedBytes, totalBytes);
        });
        response.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      });
      req.on('error', reject);
    };

    request(url);
  });
}

function parseContentLength(value: string | string[] | undefined): number | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  const parsed = text ? Number.parseInt(text, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function sha1File(file: string): Promise<string> {
  const hash = crypto.createHash('sha1');
  const stream = require('node:fs').createReadStream(file);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function extractZip(zipFile: string, destination: string): Promise<void> {
  if (process.platform === 'win32') {
    await runCommand('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath ${quotePowerShell(zipFile)} -DestinationPath ${quotePowerShell(destination)} -Force`]);
    return;
  }

  await runCommand('unzip', ['-q', zipFile, '-d', destination]);
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function findFile(directory: string, fileName: string): Promise<string | undefined> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return entryPath;
    }
    if (entry.isDirectory()) {
      const found = await findFile(entryPath, fileName);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

async function commandExists(command: string): Promise<boolean> {
  const executable = process.platform === 'win32' ? 'where.exe' : 'which';
  return runCommand(executable, [command]).then(() => true, () => false);
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await runCommandWithOutput(command, args).then(() => undefined);
}

async function runCommandWithOutput(command: string, args: string[], options: { allowFailure?: boolean } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || options.allowFailure) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr.trim() || `${command} exited with code ${code}.`));
      }
    });
  });
}

async function stopProcess(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null || process.killed) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      process.kill('SIGKILL');
      resolve();
    }, 3000);
    process.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
    process.kill('SIGINT');
  });
}

async function fileExists(file: string): Promise<boolean> {
  return fs.access(file).then(() => true, () => false);
}

function fileExistsSync(file: string): boolean {
  try {
    require('node:fs').accessSync(file);
    return true;
  } catch {
    return false;
  }
}
