#!/usr/bin/env bun

import { getLastPrompt } from "../store/promptsDb"
import { launchCodex } from "../utils/codex"

function main(): void {
  const prompt = getLastPrompt()
  if (!prompt) {
    console.error("No prompts have been saved yet.")
    process.exit(1)
  }

  try {
    launchCodex({ prompt: prompt.text, workdir: process.cwd() })
  } catch (err) {
    console.error("Failed to launch Codex:", (err as Error).message)
    process.exit(1)
  }
}

main()
