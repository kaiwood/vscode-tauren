import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { calculatePcm16Dbfs, isSpeechLevel } from './audioLevel';
import type { VoiceHandsFreeSensitivity } from './types';
import { getFfmpegPcmStreamCommand } from './voiceInputDevices';
import { writePcm16Wav } from './wavWriter';

const sampleRate = 16000;
const channels = 1;
const bytesPerSample = 2;
const frameMs = 30;
const frameBytes = sampleRate * channels * bytesPerSample * frameMs / 1000;
const preRollMs = 500;
const preRollFrameCount = Math.ceil(preRollMs / frameMs);
const speechStartThresholdDbfsBySensitivity: Record<VoiceHandsFreeSensitivity, number> = {
  low: -55,
  normal: -65,
  high: -75
};
const speechContinueThresholdDbfsBySensitivity: Record<VoiceHandsFreeSensitivity, number> = {
  low: -38,
  normal: -45,
  high: -52
};
const minSpeechMs = 180;
const minUtteranceMs = 450;
const audioStartupTimeoutMs = 2500;

type HandsFreePhase = 'listening' | 'recording' | 'stopping' | 'stopped';

export type HandsFreeRuntimeSettings = {
  sensitivity: VoiceHandsFreeSensitivity;
  silenceSeconds: number;
  maxUtteranceSeconds: number;
};

type HandsFreeRuntimeOptions = HandsFreeRuntimeSettings & {
  inputDeviceId: string;
  tempDirectory: string;
  onStatus: (status: 'listening' | 'recording') => void;
  onAudioLevel: (level: number) => void;
  onUtterance: (audioFile: string) => Promise<void> | void;
  onError: (error: Error) => void;
  getShouldContinue: () => boolean;
};

export class HandsFreeRuntime {
  private process: ChildProcess | undefined;
  private stderr = '';
  private pending = Buffer.alloc(0);
  private preRoll: Buffer[] = [];
  private utterance: Buffer[] = [];
  private phase: HandsFreePhase = 'stopped';
  private speechMs = 0;
  private utteranceMs = 0;
  private silenceMs = 0;
  private utterancePeakDbfs = Number.NEGATIVE_INFINITY;
  private sequence = 0;
  private handlingUtterance = false;
  private lastAudioLevelUpdate = 0;
  private receivedAudio = false;
  private startupTimer: NodeJS.Timeout | undefined;
  private settings: HandsFreeRuntimeSettings;

  public constructor(private readonly options: HandsFreeRuntimeOptions) {
    this.settings = {
      sensitivity: options.sensitivity,
      silenceSeconds: options.silenceSeconds,
      maxUtteranceSeconds: options.maxUtteranceSeconds
    };
  }

  public updateSettings(settings: HandsFreeRuntimeSettings): void {
    this.settings = settings;
  }

  public start(): void {
    if (this.process) {
      return;
    }

    const command = getFfmpegPcmStreamCommand(this.options.inputDeviceId);
    this.phase = 'listening';
    this.options.onStatus('listening');

    const child = spawn(command.executable, command.args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.process = child;
    this.startupTimer = setTimeout(() => {
      if (!this.receivedAudio && this.phase !== 'stopping' && this.phase !== 'stopped') {
        this.fail(new Error('Hands-free listening started, but no microphone audio was received. Check the selected input device.'));
      }
    }, audioStartupTimeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => this.handleAudio(chunk));
    child.stderr?.on('data', (chunk) => { this.stderr += String(chunk); });
    child.on('error', (error) => this.fail(error));
    child.on('close', (code) => {
      const wasStopping = this.phase === 'stopping' || !this.options.getShouldContinue();
      this.clearStartupTimer();
      this.process = undefined;
      this.phase = 'stopped';

      if (!wasStopping) {
        this.fail(new Error(getFfmpegErrorMessage(this.stderr, code)));
      }
    });
  }

  public async stop(): Promise<void> {
    this.phase = 'stopping';
    this.clearStartupTimer();
    await this.stopProcess();
    this.resetAudioState();
  }

  private handleAudio(chunk: Buffer): void {
    if (this.phase === 'stopping' || this.phase === 'stopped' || this.handlingUtterance) {
      return;
    }

    this.receivedAudio = true;
    this.clearStartupTimer();
    this.pending = Buffer.concat([this.pending, chunk]);
    while (this.pending.length >= frameBytes && !this.handlingUtterance) {
      const frame = this.pending.subarray(0, frameBytes);
      this.pending = this.pending.subarray(frameBytes);
      void this.handleFrame(Buffer.from(frame));
    }
  }

  private async handleFrame(frame: Buffer): Promise<void> {
    const dbfs = calculatePcm16Dbfs(frame);
    const startThreshold = speechStartThresholdDbfsBySensitivity[this.settings.sensitivity];
    const continueThreshold = speechContinueThresholdDbfsBySensitivity[this.settings.sensitivity];
    this.postAudioLevel(dbfs);

    if (this.phase === 'listening') {
      this.pushPreRoll(frame);
      if (isSpeechLevel(dbfs, startThreshold)) {
        this.beginUtterance(dbfs);
      }
      return;
    }

    if (this.phase !== 'recording') {
      return;
    }

    const dynamicContinueThreshold = Math.max(continueThreshold, this.utterancePeakDbfs - 10);
    this.utterance.push(frame);
    this.utteranceMs += frameMs;

    if (isSpeechLevel(dbfs, dynamicContinueThreshold)) {
      this.utterancePeakDbfs = Math.max(this.utterancePeakDbfs, dbfs);
      this.speechMs += frameMs;
      this.silenceMs = 0;
    } else {
      this.silenceMs += frameMs;
    }

    const maxUtteranceMs = this.settings.maxUtteranceSeconds * 1000;
    const reachedMaxUtterance = maxUtteranceMs > 0 && this.utteranceMs >= maxUtteranceMs;
    const reachedSilence = this.speechMs >= minSpeechMs && this.silenceMs >= this.settings.silenceSeconds * 1000;

    if (reachedSilence || reachedMaxUtterance) {
      await this.finishUtterance();
    }
  }

  private postAudioLevel(dbfs: number): void {
    const now = Date.now();
    if (now - this.lastAudioLevelUpdate < 500) {
      return;
    }

    this.lastAudioLevelUpdate = now;
    this.options.onAudioLevel(normalizeAudioLevel(dbfs));
  }

  private pushPreRoll(frame: Buffer): void {
    this.preRoll.push(frame);
    if (this.preRoll.length > preRollFrameCount) {
      this.preRoll.shift();
    }
  }

  private beginUtterance(dbfs: number): void {
    this.phase = 'recording';
    this.utterance = [...this.preRoll];
    this.utteranceMs = this.utterance.length * frameMs;
    this.speechMs = frameMs;
    this.silenceMs = 0;
    this.utterancePeakDbfs = dbfs;
    this.options.onStatus('recording');
  }

  private async finishUtterance(): Promise<void> {
    const utterance = this.utterance;
    const utteranceMs = this.utteranceMs;
    const speechMs = this.speechMs;
    this.handlingUtterance = true;
    this.resetAudioState();

    if (utteranceMs < minUtteranceMs || speechMs < minSpeechMs) {
      this.handlingUtterance = false;
      return;
    }

    const audioFile = path.join(this.options.tempDirectory, `tauren-voice-${Date.now()}-${this.sequence++}.wav`);
    try {
      await writePcm16Wav(audioFile, utterance, sampleRate, channels);
      await this.options.onUtterance(audioFile);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.handlingUtterance = false;
      if (this.options.getShouldContinue()) {
        this.phase = 'listening';
        this.options.onStatus('listening');
      }
    }
  }

  private resetAudioState(): void {
    this.pending = Buffer.alloc(0);
    this.preRoll = [];
    this.utterance = [];
    this.speechMs = 0;
    this.utteranceMs = 0;
    this.silenceMs = 0;
    this.utterancePeakDbfs = Number.NEGATIVE_INFINITY;
    this.options.onAudioLevel(0);
  }

  private clearStartupTimer(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = undefined;
    }
  }

  private fail(error: Error): void {
    this.clearStartupTimer();
    if (this.phase === 'stopping' || this.phase === 'stopped') {
      return;
    }

    this.phase = 'stopped';
    this.process = undefined;
    void this.stopProcess().catch(() => undefined);
    this.options.onError(error);
  }

  private async stopProcess(): Promise<void> {
    const child = this.process;
    if (!child || child.exitCode !== null || child.killed) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 3000);
      child.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill('SIGINT');
    });
  }
}

function normalizeAudioLevel(dbfs: number): number {
  if (!Number.isFinite(dbfs)) {
    return 0;
  }

  const normalized = (dbfs + 80) / 55;
  return Math.max(0, Math.min(1, normalized));
}

function getFfmpegErrorMessage(stderr: string, code: number | null): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, '').trim())
    .filter(Boolean);
  const importantLine = [...lines].reverse().find((line) => /error|denied|busy|unavailable|invalid|failed|not found|no such/i.test(line));
  return importantLine ?? (code === null ? 'ffmpeg stopped before audio was captured.' : `ffmpeg exited with code ${code}.`);
}
