# glu-code — Linux Voice -> Code

Terminal-first prompt recorder with speech-to-text (Vosk), OpenTUI UI, local SQLite history, and one-key Codex launches in tmux.

[!NOTE]: WIP mainly works on Linux, rough around the edges.

## Prereqs

- Bun installed (`bun --version` should work)
- tmux installed
- Vosk model downloaded (set `VOSK_MODEL_PATH` to its folder, defaults to `~/.local/share/vosk/model`)
- Audio capture backend compatible with `node-record-lpcm16` (`sox` or `arecord` installed and working; set `RECORDER=arecord` to force ALSA)

## Install

```bash
bun install
```

## Run the TUI (Node/tsx)

```bash
npx tsx --experimental-loader ./scripts/file-loader.mjs src/cli/gluCode.ts
# or:
npm run start:node
# or via the provided bin (uses tsx loader):
./bin/glu-code
```

Keymap: `R` record/stop · `E` edit · `S` save · `H` history toggle · `C` launch Codex in tmux · `Q` quit.

## Launch Codex with the last prompt

```bash
npx tsx --experimental-loader ./scripts/file-loader.mjs src/cli/codexLast.ts
# or:
npm run codex:last:node
# or:
./bin/glu-code-codex-last
```

## Download a Vosk model (example: small en-us)

```bash
mkdir -p ~/.local/share/vosk && cd ~/.local/share/vosk
wget https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
unzip vosk-model-small-en-us-0.15.zip
rm vosk-model-small-en-us-0.15.zip
mv vosk-model-small-en-us-0.15 model  # points the default path to this model
# or set VOSK_MODEL_PATH to another model directory
```

## Storage

Prompts are stored in SQLite at `~/.local/share/glu-code/prompts.db`.

## Notes

- Make sure the Vosk model sample rate matches the recorder (default 16kHz).
- The TUI keeps running after you spawn Codex so you can capture more prompts.
