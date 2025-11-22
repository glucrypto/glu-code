import { spawn, spawnSync } from "node:child_process"
import { resolve } from "node:path"

export interface CodexLaunchOptions {
  prompt: string
  workdir?: string
  extraArgs?: string[]
  windowName?: string
}

export interface CodexLaunchResult {
  windowName: string
  command: string
}

export function launchCodex(options: CodexLaunchOptions): CodexLaunchResult {
  const prompt = options.prompt.trim()
  if (!prompt) {
    throw new Error("Prompt is empty")
  }

  ensureTmux()

  const workdir = options.workdir ? resolve(options.workdir) : process.cwd()
  const extraArgs = options.extraArgs ?? []
  const codexCommand = buildCodexCommand(prompt, extraArgs)
  const windowName = options.windowName ?? defaultWindowName()
  const tmuxArgs = ["new-window", "-n", windowName, "-c", workdir, codexCommand]

  const proc = spawn("tmux", tmuxArgs, { stdio: "ignore", detached: true })
  proc.unref()
  return { windowName, command: codexCommand }
}

function buildCodexCommand(prompt: string, extraArgs: string[]): string {
  const encodedPrompt = JSON.stringify(prompt)
  const extra = extraArgs.length > 0 ? ` ${extraArgs.join(" ")}` : ""
  return `codex ${encodedPrompt}${extra}`
}

function defaultWindowName(): string {
  return `codex-${Date.now().toString(36)}`
}

function ensureTmux(): void {
  const res = spawnSync("tmux", ["-V"])
  if (res.error) {
    throw new Error('tmux executable not found in PATH. Please install tmux.')
  }
}
