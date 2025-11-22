#!/usr/bin/env node

// Node STT helper: reads mic -> Vosk and outputs JSON lines to stdout.

const fs = require("node:fs")
const path = require("node:path")
const record = require("node-record-lpcm16")

function loadVosk() {
  try {
    return require("vosk")
  } catch (err) {
    console.error(JSON.stringify({ type: "error", error: `Failed to load vosk: ${(err && err.message) || err}` }))
    process.exit(1)
  }
}

const args = parseArgs(process.argv.slice(2))
const modelPath = args.model || process.env.VOSK_MODEL_PATH || path.join(process.env.HOME || "", ".local", "share", "vosk", "model")
const sampleRate = Number(args.sampleRate || 16000)
const device = args.device

if (!fs.existsSync(modelPath)) {
  console.error(JSON.stringify({ type: "error", error: `Model path not found: ${modelPath}` }))
  process.exit(1)
}

const vosk = loadVosk()
vosk.setLogLevel(0)

let recorder
let recognizer

function start() {
  const model = new vosk.Model(modelPath)
  recognizer = new vosk.Recognizer({ model, sampleRate })

  try {
    recorder = record.record({
      sampleRate,
      channels: 1,
      audioType: "wav",
      threshold: 0,
      device,
      endOnSilence: false,
      verbose: false,
    })
  } catch (err) {
    emitError(`failed to start recorder: ${err.message || err}`)
    process.exit(1)
  }

  const stream = recorder.stream()
  stream.on("data", (data) => handleChunk(data))
  stream.on("error", (err) => emitError(`recorder error: ${err.message || err}`))

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

function handleChunk(data) {
  if (!recognizer) return
  const recognized = recognizer.acceptWaveform(data)
  if (recognized) {
    const text = safeParseText(recognizer.result())
    if (text) emit({ type: "final", text })
  } else {
    const partial = safeParsePartial(recognizer.partialResult())
    if (partial) emit({ type: "partial", text: partial })
  }
}

function shutdown() {
  try {
    recorder && recorder.stop()
  } catch (err) {
    emitError(`recorder stop error: ${err.message || err}`)
  }
  if (recognizer) {
    const final = safeParseText(recognizer.finalResult())
    if (final) emit({ type: "final", text: final })
    recognizer.free()
  }
  process.exit(0)
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n")
}

function emitError(msg) {
  process.stderr.write(msg + "\n")
  emit({ type: "error", error: msg })
}

function safeParsePartial(result) {
  const payload = typeof result === "string" ? safeJson(result) : result
  if (payload && typeof payload === "object" && "partial" in payload) {
    const text = payload.partial
    return text && text.trim().length > 0 ? text.trim() : null
  }
  return null
}

function safeParseText(result) {
  const payload = typeof result === "string" ? safeJson(result) : result
  if (payload && typeof payload === "object" && "text" in payload) {
    const text = payload.text
    return text && text.trim().length > 0 ? text.trim() : null
  }
  return null
}

function safeJson(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--model") out.model = argv[++i]
    if (arg === "--sample-rate") out.sampleRate = argv[++i]
    if (arg === "--device") out.device = argv[++i]
  }
  return out
}

start()
