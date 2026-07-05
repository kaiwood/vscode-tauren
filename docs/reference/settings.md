# Settings

This page lists Tauren-owned VS Code settings. Pi-owned runtime settings are available inside the Tauren settings UI and are stored by Pi.

The **Settings pane** column shows where the same control appears inside Tauren: `Settings category → Human readable name`.

## Appearance

| Setting | Settings pane | Default | Description |
| --- | --- | --- | --- |
| `tauren.outputColors` | Appearance → Output colors | `true` | Enable ANSI and syntax colors in Tauren output boxes. When disabled, ANSI escape sequences are stripped. |
| `tauren.animationsEnabled` | Appearance → Animations | `true` | Enable animations in the Tauren sidebar. Reduced-motion preferences still disable motion. |
| `tauren.showWelcome` | Appearance → Welcome message | `true` | Show the Welcome to Tauren empty state for new chats. |
| `tauren.useTaurenShareViewer` | Appearance → Tauren export style | `true` | Use Tauren docs styling for HTML exports and new `/share` links. When disabled, exports keep Pi styling and `/share` uses pi.dev unless `PI_SHARE_VIEWER_URL` is set. |
| `tauren.customUiTheme` | Appearance → Custom UI theme | `default` | Visual theme for Pi extension custom UI terminal panels. Options: `default`, `modern`, `crt`, `amber`, `matrix`. |

## Extension surfaces

| Setting | Settings pane | Default | Description |
| --- | --- | --- | --- |
| `tauren.extensions.aboveWidgetsEnabled` | Extensions → Enable above widgets | `true` | Show Pi extension widgets above the composer. |
| `tauren.extensions.belowWidgetsEnabled` | Extensions → Enable below widgets | `true` | Show Pi extension widgets below the composer. |
| `tauren.extensions.statusBarEnabled` | Extensions → Enable status bar | `true` | Show one-line Pi extension status updates below the composer. |
| `tauren.extensions.backgroundColorsEnabled` | Extensions → Enable background colors | `true` | Render background colors sent by Pi extension widgets. |
| `tauren.extensions.monospaceFontEnabled` | Extensions → Use monospace font | `true` | Use the editor monospace font for Pi extension widgets and status. |

## Voice

| Setting | Settings pane | Default | Description |
| --- | --- | --- | --- |
| `tauren.voice.enabled` | Voice → Voice input | `false` | Show the microphone control in the Chat Input and allow local speech-to-text. |
| `tauren.voice.model` | Voice → Voice model | `base.en` | Local Whisper model Tauren should use for speech-to-text. Options: `tiny.en`, `base.en`, `small.en`, `tiny`, `base`, `small`. |
| `tauren.voice.inputDevice` | Voice → Voice input device | `default` | Microphone or audio input source Tauren should record from. Use the Voice settings pane to select a detected device. |
| `tauren.voice.language` | Voice → Voice language | `auto` | Language Tauren passes to whisper.cpp. English-only models always use English. |
| `tauren.voice.mode` | Voice → Voice mode | `pushToTalk` | Choose manual push-to-talk recording or explicit hands-free listening. Options: `pushToTalk`, `handsFree`. |
| `tauren.voice.activationMode` | Voice → Microphone action | `toggle` | Choose whether the microphone button starts/stops recording or records only while held. Options: `toggle`, `hold`. |
| `tauren.voice.maxRecordingSeconds` | Voice → Maximum recording length | `60` | Maximum voice recording length before Tauren stops recording automatically. Options: `0`, `15`, `30`, `60`, `120`. |
| `tauren.voice.handsFreeSensitivity` | Voice → Hands-free sensitivity | `normal` | How readily hands-free listening treats microphone input as speech. Options: `low`, `normal`, `high`. |
| `tauren.voice.handsFreeSilenceSeconds` | Voice → Hands-free silence stop | `1.2` | Silence duration after speech before hands-free listening finalizes and transcribes the utterance. Options: `0.8`, `1.2`, `1.5`, `2`. |
| `tauren.voice.transcriptAction` | Voice → After transcription | `insert` | Choose whether completed voice transcripts are inserted into the Chat Input or submitted automatically. Options: `insert`, `submit`. |

See [Voice Input](../guide/voice-input.md) for setup and workflows.

## Safety

| Setting | Settings pane | Default | Description |
| --- | --- | --- | --- |
| `tauren.blockHttpsImages` | Safety → Block HTTPS images | `true` | Block remote HTTPS images in Tauren chat markdown while still allowing Pi image data and workspace images. |
| `tauren.confirmSessionDeletion` | Safety → Confirm deletion | `true` | Ask for confirmation before moving Tauren sessions to Trash. |
| `tauren.restrictFileReferencesToWorkspace` | Safety → Restrict file links | `true` | Only open Tauren sidebar file references when they resolve inside the workspace. |
| `tauren.rejectEditWriteOutsideWorkspace` | Safety → Reject external edits | `false` | Reject Pi edit/write tool mutations outside the active workspace folder. This does not restrict shell commands. |

## Advanced

| Setting | Settings pane | Default | Description |
| --- | --- | --- | --- |
| `tauren.debugPerformance` | Advanced → Debug performance | `false` | Collect Tauren performance diagnostics in the output channel and diagnostics view. |
| `tauren.readyScript` | Advanced → Ready script | `""` | Path to an executable script to run when Pi becomes ready. Relative paths resolve from the workspace folder. |
| `tauren.readyScriptEnabled` | Advanced → Run ready script | `true` | Enable or temporarily disable the configured ready script. |

## Pi runtime settings

The Tauren settings UI also exposes Pi-owned runtime controls such as provider, model, thinking level, compaction, retry, steering, follow-up behavior, image handling, enabled models, and skill commands.

Pi remains the source of truth for those values. Tauren displays and edits them through the SDK runtime.
