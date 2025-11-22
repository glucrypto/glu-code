#!/usr/bin/env bun
import { spawn } from "node:child_process"
import readline from "node:readline"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const modelPath =
  process.env.VOSK_MODEL_PATH || resolve(process.env.HOME || "", ".local/share/vosk/model")
const targetWindow = process.env.XDO_WINDOW_ID
const recorderPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../scripts/stt-helper.cjs",
)

if (!targetWindow) {
  console.error("Set XDO_WINDOW_ID to the target window id (xdotool search ...).")
  process.exit(1)
}

console.log(`Starting headless recorder -> xdotool (target window ${targetWindow})`)
const proc = spawn("node", [recorderPath, "--model", modelPath, "--sample-rate", "16000"], {
  stdio: ["ignore", "pipe", "pipe"],
})

const rl = readline.createInterface({ input: proc.stdout })
rl.on("line", (line) => {
  try {
    const evt = JSON.parse(line) as { type: string; text?: string; error?: string }
    if (evt.type === "partial") {
      process.stdout.write(`partial: ${evt.text}\r`)
    } else if (evt.type === "final" && evt.text) {
      process.stdout.write(`\nfinal: ${evt.text}\n`)
      injectText(evt.text)
    } else if (evt.type === "error") {
      console.error(`stt error: ${evt.error}`)
    }
  } catch {
    // ignore
  }
})

proc.stderr?.on("data", (buf) => {
  process.stderr.write(buf)
})

proc.on("exit", () => process.exit(0))

function injectText(text: string): void {
  const msg = text.replace(/\s+/g, " ").trim()
  if (!msg) return
  const cmd: string[] = [
    "xdotool",
    "windowactivate",
    "--sync",
    targetWindow!,
    "key",
    "ctrl+a",
    "ctrl+k",
    "type",
    "--delay",
    "0",
    msg,
    "key",
    "Return",
  ]
  const child = spawn(cmd[0], cmd.slice(1), { stdio: "inherit" })
  child.on("exit", (code: number | null) => {
    if (code !== 0) {
      console.error(`xdotool failed with code ${code}`)
    }
  })
}
