# Hands-free Talk: the wake word (experimental, #1228)

🎙▾ > **Hands-free (wake word)** keeps the microphone open in the tab that holds Talk. Say the wake name, then the message ("Docket, tell it yes, the second option"), or the wake name, a pause, then the message. A chime says it heard you. The message goes to the session whose question was read aloud last (or the session you name: "Docket, tell relay fix to rerun the tests"; or the open one). It is read back ("Sending to Relay fix: …") and sent after 3 seconds unless you say "cancel" (or "send" to send at once). A whole screen command ("Docket, next", "Docket, read it") is done at once. While Read aloud is speaking, only "Docket, stop" is heard.

It keeps listening while the screen is locked, unlike the rest of Talk, and turns itself off after 30 minutes without the wake name. Audio never leaves the computer: the voice activity detector and openWakeWord run in `talk-wake-worker.mjs`, Whisper in `talk-worker.mjs`, both in the page.

## Settings: 🎙▾ > Hands-free settings and log

Kept by Docket on this computer (`state.handsFree` in its state file), since two computers side by side may share one microphone:

- **Wake name**: each computer in a room should have its own, so one sentence wakes only one.
- **This computer in the read-back** and **Another Docket listens in this room**: the read-back then starts with this computer's name ("Study sending to …"), so a wrong wake is caught before it sends. Docket also does this when it sees a Remote Desk on another computer.
- **Hear the wake name with**:
  - **A, Whisper check**: the speech model works out the first two seconds of every stretch of speech and looks for the wake name at the start, loosely ("Docket" also takes "doc it", "dock it", "locket"). Any name works at once. Costs a Whisper run for every stretch of speech in the room.
  - **B, wake-word model**: [openWakeWord](https://github.com/dscripka/openWakeWord), three small ONNX models on every 80 ms of sound. Much lighter, but it hears only the phrase its model was trained on.
  - **Both**: either wakes it. Method A then also listens for B's phrase, so the two can be compared on the same words.
- **When it hears you**: **Compare only** (the default) reads each wake back and logs it, and never sends or does anything. Say "yes" when it was you, "cancel" when it was not. **Send what I say** sends.

## The comparison log

`<data>/talk-wake.jsonl`, the last 2000 rows. One row for each wake: the time, the mode, which methods ran and which woke it first, what A heard (its words, cut to 80 characters, and its score) and B's best score, and what came of it (sent, yes, cancelled, stopped, nothing said, no answer). One row for each stretch of listening (every 10 minutes and when it turns off): the minutes, and the ms the detector, openWakeWord and Whisper's checks took (Whisper on the graphics card or processor). No audio is ever kept. The settings show, for each method: wakes, right and wrong, wrong wakes an hour, misses (the other method woke it, it was right, and this one did not), and processor and graphics card time an hour.

## The model files

Docket fetches each model once into `<data>/wake-models` and serves it to the page (`/api/wake-model/<name>.onnx`), from pinned releases: Silero VAD v5 from Hugging Face (onnx-community/silero-vad at one revision), and openWakeWord v0.5.1's `melspectrogram.onnx`, `embedding_model.onnx` and pre-trained wake models (Hey Jarvis, Hey Mycroft, Alexa, Hey Rhasspy) from its GitHub release.

openWakeWord's pre-trained wake models are licensed **CC BY-NC-SA 4.0 (non-commercial use only)**. For anything else, train your own; the feature models it builds on are Apache 2.0.

## A wake-word model of your own ("Docket")

There is no pre-trained "Docket" model. To make one:

1. Train it with openWakeWord's automatic training notebook (`notebooks/automatic_model_training.ipynb` in the openWakeWord repository; it runs on Google Colab with a GPU in about an hour). It makes thousands of spoken samples of the phrase with Piper text-to-speech, mixes in noise and room sound, and trains a small model on openWakeWord's speech embeddings. Give it the phrase as it sounds ("docket"), and export the ONNX model.
2. Put the `.onnx` file in `<data>/wake-models` on each computer that should use it. Its file name is its phrase: `docket.onnx` shows as "Docket", `hey_study.onnx` as "Hey study".
3. In Hands-free settings, pick it under **Wake-word model (B)**. A model named like the computer's wake name is picked by default.

The model must take openWakeWord's 16 × 96 embedding window (`[1, 16, 96]`) and give one score from 0 to 1, as every openWakeWord model does. Until a name has a model, use method A for it.

## Still to check in a real room

- Bluetooth headsets and speakerphones that connect to two computers (multipoint) usually give the microphone (hands-free profile) to one of them at a time, so the second computer may hear nothing. Microphone help says when the microphone picked looks like a Bluetooth one.
- How well each method hears from across the room, and how often a television wakes it: run Compare only for a day and read the numbers.
- macOS.
