# Voice Input

Tauren can turn speech into Chat Input text with local whisper.cpp transcription. It is useful when you want to dictate a prompt, talk through a messy problem, or keep your hands on the keyboard while capturing a longer thought.

Voice input is local: Tauren records from the selected microphone, transcribes with a downloaded Whisper model, and then inserts or submits the resulting text in the Chat Lane.

## When to use it

Use voice input when:

- a prompt is easier to say than type,
- you want to sketch a debugging plan out loud,
- you are pairing and want to capture spoken notes,
- you want hands-free utterances while reading code.

For careful prompts, keep the default **Insert into Chat Input** behavior. Tauren will place the transcript in the Composer so you can edit it before sending.

## Set it up

1. Open the Settings Face:

   ```text
   /settings
   ```

2. Go to **Voice**.
3. Enable **Voice input**.
4. Download the local **whisper.cpp** binary if Tauren shows it as missing.
5. Choose a **Voice model** and download it.
6. Pick your **Voice input device**.

After setup, the microphone control appears in the Composer.

## Choose a model

Tauren supports English-only and multilingual Whisper models:

| Model | Best for |
| --- | --- |
| Tiny English | Fastest English dictation. |
| Base English | Balanced default for English prompts. |
| Small English | Better English accuracy, larger download. |
| Tiny Multilingual | Fast multilingual dictation. |
| Base Multilingual | Balanced multilingual dictation. |
| Small Multilingual | Better multilingual accuracy, larger download. |

If you only dictate English, start with **Base English**. If you use auto-detect or speak a non-English language, choose a multilingual model.

## Push-to-talk workflow

Push-to-talk is the safest mode for normal coding sessions.

1. Set **Voice mode** to **Push to talk**.
2. Choose **Microphone action**:
   - **Click to toggle**: click once to start recording, click again to stop.
   - **Hold to talk**: record only while holding the microphone button.
3. Click or hold the microphone in the Composer.
4. Speak your prompt.
5. Stop recording and wait for transcription.
6. Review the inserted text, then send it when ready.

Example spoken prompt:

```text
Look at the authentication tests and find why the session refresh case is flaky. Do not edit yet. Start by explaining the likely failure path.
```

With **After transcription** set to **Insert into Chat Input**, Tauren puts that text into the Composer instead of sending it immediately.

## Hands-free workflow

Hands-free mode keeps the selected microphone open locally while listening is enabled. Tauren detects speech, waits for silence, transcribes the utterance, then either inserts or submits it depending on **After transcription**.

Use hands-free when you want to capture multiple short prompts without touching the microphone button every time.

1. Set **Voice mode** to **Hands-free**.
2. Keep **After transcription** set to **Insert into Chat Input** until you trust your setup.
3. Adjust **Hands-free sensitivity**:
   - **Low** for noisy rooms.
   - **Normal** for most rooms.
   - **High** for quiet speech, with more risk of background noise triggering input.
4. Adjust **Hands-free silence stop** if Tauren cuts you off too quickly or waits too long.
5. Click the microphone control to start listening.
6. Click it again when you want hands-free listening off.

Hands-free is explicit. Tauren does not enable it unless you choose hands-free mode and start listening.

## What happens after transcription

The **After transcription** setting controls the final step:

| Setting | Behavior |
| --- | --- |
| Insert into Chat Input | Put the transcript in the Composer for review. |
| Submit automatically | Send the transcript to Tauren immediately. |

Use automatic submit only when your microphone, model, and room are reliable. Dictation mistakes can become real prompts, and Pi may act on them.

## Privacy and limitations

- Transcription runs locally through whisper.cpp assets downloaded from the Voice settings pane.
- Hands-free mode keeps the selected microphone open locally while listening is enabled.
- English-only models always use English, even if **Voice language** is set to auto-detect.
- Background noise can trigger hands-free transcription. Use lower sensitivity in noisy rooms.
- Local transcription quality depends on the model size, microphone quality, room noise, and spoken language.

## Related settings

Voice settings are Tauren-owned settings because they control the VS Code sidebar and local transcription workflow:

- `tauren.voice.enabled`
- `tauren.voice.model`
- `tauren.voice.inputDevice`
- `tauren.voice.language`
- `tauren.voice.mode`
- `tauren.voice.activationMode`
- `tauren.voice.maxRecordingSeconds`
- `tauren.voice.handsFreeSensitivity`
- `tauren.voice.handsFreeSilenceSeconds`
- `tauren.voice.transcriptAction`

See the [settings reference](../reference/settings.md#voice) for defaults and exact setting names.
