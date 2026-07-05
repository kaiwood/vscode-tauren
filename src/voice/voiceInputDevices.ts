import { spawn } from 'node:child_process';
import type { VoiceInputDevice } from './types';

export function getFfmpegRecordingCommand(audioFile: string, inputDeviceId: string): { executable: string; args: string[] } {
  return getFfmpegInputCommand(inputDeviceId, ['-ar', '16000', '-ac', '1', audioFile]);
}

export function getFfmpegPcmStreamCommand(inputDeviceId: string): { executable: string; args: string[] } {
  return getFfmpegInputCommand(inputDeviceId, ['-ar', '16000', '-ac', '1', '-f', 's16le', 'pipe:1']);
}

function getFfmpegInputCommand(inputDeviceId: string, outputArgs: string[]): { executable: string; args: string[] } {
  const deviceId = inputDeviceId || 'default';

  if (process.platform === 'darwin') {
    const input = deviceId === 'default' ? ':0' : `:${deviceId}`;
    return { executable: 'ffmpeg', args: ['-y', '-f', 'avfoundation', '-i', input, ...outputArgs] };
  }

  if (process.platform === 'win32') {
    const input = deviceId === 'default' ? 'audio=default' : `audio=${deviceId}`;
    return { executable: 'ffmpeg', args: ['-y', '-f', 'dshow', '-i', input, ...outputArgs] };
  }

  const input = deviceId === 'default' ? 'default' : deviceId;
  return { executable: 'ffmpeg', args: ['-y', '-f', 'pulse', '-i', input, ...outputArgs] };
}

export async function listInputDevices(): Promise<VoiceInputDevice[]> {
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
