import type { VoiceBinaryAsset, VoiceModelAsset, VoiceModelId } from './types';

export const defaultVoiceModelId: VoiceModelId = 'base.en';

export const voiceModelAssets = [
  {
    id: 'tiny.en',
    label: 'Tiny English',
    description: 'Fastest local model. Lower accuracy, about 75 MiB.',
    fileName: 'ggml-tiny.en.bin',
    sizeBytes: 75 * 1024 * 1024,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
    sha1: 'c78c86eb1a8faa21b369bcd33207cc90d64ae9df'
  },
  {
    id: 'base.en',
    label: 'Base English',
    description: 'Balanced default for local voice input, about 142 MiB.',
    fileName: 'ggml-base.en.bin',
    sizeBytes: 142 * 1024 * 1024,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    sha1: '137c40403d78fd54d454da0f9bd998f78703390c'
  },
  {
    id: 'small.en',
    label: 'Small English',
    description: 'Better accuracy, larger download, about 466 MiB.',
    fileName: 'ggml-small.en.bin',
    sizeBytes: 466 * 1024 * 1024,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
    sha1: 'db8a495a91d927739e50b3fc1cc4c6b8f6c2d022'
  },
  {
    id: 'tiny',
    label: 'Tiny Multilingual',
    description: 'Fastest multilingual model. Lower accuracy, about 74 MiB.',
    fileName: 'ggml-tiny.bin',
    sizeBytes: 77691713,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
    sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21'
  },
  {
    id: 'base',
    label: 'Base Multilingual',
    description: 'Balanced multilingual model, about 141 MiB.',
    fileName: 'ggml-base.bin',
    sizeBytes: 147951465,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'
  },
  {
    id: 'small',
    label: 'Small Multilingual',
    description: 'Better multilingual accuracy, larger download, about 465 MiB.',
    fileName: 'ggml-small.bin',
    sizeBytes: 487601967,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b'
  }
] as const satisfies readonly VoiceModelAsset[];

const whisperRelease = 'v1.8.6';

export const voiceBinaryAssets = [
  {
    platform: 'win32',
    arch: 'x64',
    label: 'whisper.cpp Windows x64',
    fileName: 'whisper-bin-x64.zip',
    executableName: 'whisper-cli.exe',
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${whisperRelease}/whisper-bin-x64.zip`
  },
  {
    platform: 'win32',
    arch: 'ia32',
    label: 'whisper.cpp Windows 32-bit',
    fileName: 'whisper-bin-Win32.zip',
    executableName: 'whisper-cli.exe',
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${whisperRelease}/whisper-bin-Win32.zip`
  }
] as const satisfies readonly VoiceBinaryAsset[];

export function getVoiceModelAsset(id: string): VoiceModelAsset | undefined {
  return voiceModelAssets.find((model) => model.id === id);
}

export function getVoiceBinaryAsset(platform = process.platform, arch = process.arch): VoiceBinaryAsset | undefined {
  return voiceBinaryAssets.find((asset) => asset.platform === platform && asset.arch === arch);
}
