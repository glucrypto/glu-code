#!/usr/bin/env bun

import { startTui } from "../tui/app"

async function main(): Promise<void> {
  try {
    await startTui()
  } catch (err) {
    console.error("Failed to start glu-code TUI:", (err as Error).message)
    process.exit(1)
  }
}

void main()
