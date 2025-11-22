import {
  BoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  TextareaRenderable,
  createCliRenderer,
  type KeyEvent,
} from "@opentui/core";
import { basename, join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import {
  type PromptRecord,
  type RunRecord,
  getLastRunForPrompt,
  listPrompts,
  logRun,
  savePrompt,
  updatePrompt,
} from "../store/promptsDb";
import { launchCodex } from "../utils/codex";

interface AppState {
  currentPrompt: string;
  activePromptId?: number;
  createdAt?: string;
  lastPartial?: string;
  isRecording: boolean;
  isEditing: boolean;
  historyOpen: boolean;
  modelPath: string;
  lastRun?: RunRecord;
  recorder?: RecorderProcess;
}

export async function startTui(modelPath?: string): Promise<void> {
  const resolvedModelPath =
    modelPath ?? process.env.VOSK_MODEL_PATH ?? defaultModelLocation();
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    targetFps: 30,
  });
attachFatalHandlers(renderer);

  const DIRNAME = dirname(fileURLToPath(import.meta.url));

  const state: AppState = {
    currentPrompt: "",
    isRecording: false,
    isEditing: false,
    historyOpen: true,
    modelPath: resolvedModelPath,
  };

  const { layoutBox, statusText, promptEditor, historyBox, historyList, promptBox, tmuxStatus } =
    buildLayout(renderer);
  // Keep state in sync when user types in the editor (only while editing)
  promptEditor.onContentChange = () => {
    if (!state.isEditing) return;
    state.currentPrompt = promptEditor.plainText;
    state.lastPartial = undefined;
    statusText.content = buildStatusLine();
  };
  renderer.root.add(layoutBox);
  renderer.setBackgroundColor("#0D1117");
  renderer.start();
  historyBox.visible = true;
  refreshHistory();
  updatePromptTitle();
  refreshTmuxStatus();

  function buildStatusLine(): string {
    const mode = state.isRecording
      ? "Recording"
      : state.isEditing
      ? "Editing"
      : "Idle";
    const partialLeaf = state.lastPartial ? " …partial" : "";
    const idLabel = state.activePromptId
      ? `#${state.activePromptId}`
      : "unsaved";
    const modelName = basename(state.modelPath);
    const runInfo = state.lastRun
      ? ` | Last run: ${formatRun(state.lastRun)}`
      : "";
    return `Mode: ${mode}${partialLeaf} | Prompt: ${idLabel} | Model: ${modelName}${runInfo} | Keys: R record · Ctrl+E edit · Ctrl+S save · Ctrl+Q exit edit · H history · C codex · Y copy · Q quit`;
  }

  function refreshPromptView(): void {
    const preview = renderPromptPreview(state);
    if (!state.isEditing) {
      promptEditor.setText(preview, { history: false });
    }
    promptEditor.showCursor = state.isEditing;
    statusText.content = buildStatusLine();
    updatePromptTitle();
    renderer.requestRender();
  }

  function appendFinalText(text: string): void {
    if (!text.trim()) return;
    const existing = state.currentPrompt.trim();
    state.currentPrompt = existing ? `${existing} ${text.trim()}` : text.trim();
    state.lastPartial = undefined;
    refreshPromptView();
  }

  function startRecording(): void {
    state.isRecording = true;
    state.isEditing = false;
    state.currentPrompt = "";
    state.lastPartial = undefined;
    state.activePromptId = undefined;
    state.lastRun = undefined;
    promptEditor.blur();
    promptEditor.showCursor = false;
    refreshPromptView();
    startRecorder();
  }

  function stopRecording(): void {
    if (!state.isRecording) return;
    state.isRecording = false;
    state.lastPartial = undefined;
    stopRecorder();
    refreshPromptView();
  }

  function toggleRecording(): void {
    if (state.isRecording) {
      stopRecording();
      return;
    }
    startRecording();
  }

  function enterEdit(): void {
    stopRecording();
    state.isEditing = true;
    promptEditor.setText(state.currentPrompt, { history: false });
    promptEditor.focus();
    promptEditor.showCursor = true;
    updatePromptTitle();
    statusText.content = buildStatusLine();
  }

  function exitEdit(): void {
    if (!state.isEditing) return;
    state.isEditing = false;
    promptEditor.blur();
    promptEditor.showCursor = false;
    state.currentPrompt = promptEditor.plainText;
    updatePromptTitle();
    refreshPromptView();
  }

  function handleSave(): void {
    const content = state.currentPrompt.trim();
    if (!content) {
      statusText.content = "Nothing to save – prompt is empty.";
      renderer.requestRender();
      return;
    }

    let record: PromptRecord;
    if (state.activePromptId) {
      record = updatePrompt(state.activePromptId, content);
    } else {
      record = savePrompt(content);
    }

    state.activePromptId = record.id;
    state.createdAt = record.createdAt;
    statusText.content = `Saved prompt #${record.id} (${record.createdAt}).`;
    updatePromptTitle();
    refreshHistory(record.id);
    renderer.requestRender();
  }

  function handleCodexLaunch(): void {
    const prompt = state.currentPrompt.trim();
    if (!prompt) {
      statusText.content = "Cannot launch Codex – prompt is empty.";
      renderer.requestRender();
      return;
    }

    if (!state.activePromptId) {
      handleSave();
    }

    try {
      const windowName = buildWindowName(state.activePromptId);
      const { windowName: actualWindow, command } = launchCodex({
        prompt,
        workdir: process.cwd(),
        windowName,
      });
      if (state.activePromptId) {
        state.lastRun = logRun(state.activePromptId, command, actualWindow);
      }
      statusText.content = `Codex launched in tmux window "${actualWindow}".`;
      refreshTmuxStatus();
    } catch (err) {
      statusText.content = `Failed to launch Codex: ${(err as Error).message}`;
    }
    renderer.requestRender();
  }

  function updatePromptTitle(): void {
    const mode = state.isEditing ? "EDIT" : state.isRecording ? "RECORD" : "VIEW";
    promptBox.title = `Current prompt (${mode})`;
  }

  function refreshTmuxStatus(): void {
    const res = spawnSync("tmux", ["list-windows", "-F", "#I:#W"], {
      encoding: "utf8",
    });
    if (res.error || res.status !== 0) {
      tmuxStatus.content = "tmux: not running";
    } else {
      const lines = res.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      tmuxStatus.content = lines.length
        ? `tmux windows: ${lines.join(" | ")}`
        : "tmux: no windows";
    }
  }

  function toggleHistory(): void {
    state.historyOpen = !state.historyOpen;
    historyBox.visible = state.historyOpen;
    if (state.historyOpen) {
      refreshHistory(state.activePromptId);
      historyList.focus();
    } else {
      historyList.blur();
    }
    renderer.requestRender();
  }

  function refreshHistory(selectedId?: number): void {
    const prompts = listPrompts(100);
    historyList.options = prompts.map((prompt) => {
      const lastRun = getLastRunForPrompt(prompt.id);
      const descPieces = [prompt.text.slice(0, 60).replace(/\s+/g, " ")];
      if (lastRun) descPieces.push(`(last run ${formatRunBrief(lastRun)})`);
      return {
        name: `#${prompt.id}`,
        description: descPieces.join(" "),
        value: { ...prompt, lastRun },
      };
    });

    if (selectedId) {
      const index = prompts.findIndex((p) => p.id === selectedId);
      if (index >= 0) {
        historyList.setSelectedIndex(index);
      }
    }
    refreshTmuxStatus();
  }

  historyList.on(SelectRenderableEvents.ITEM_SELECTED, (_idx, option) => {
    const prompt = option.value as PromptRecord & { lastRun?: RunRecord };
    state.currentPrompt = prompt.text;
    state.activePromptId = prompt.id;
    state.createdAt = prompt.createdAt;
    state.lastRun = prompt.lastRun ?? getLastRunForPrompt(prompt.id);
    state.isEditing = false;
    promptEditor.setText(prompt.text, { history: false });
    promptEditor.blur();
    promptEditor.showCursor = false;
    refreshPromptView();
  });

  function startRecorder(): void {
    stopRecorder();
    const args = buildRecorderArgs(state.modelPath);
    const proc = spawn("node", args, { stdio: ["ignore", "pipe", "pipe"] });
    const recorderState: RecorderProcess = { proc, lastStderr: "" };
    state.recorder = recorderState;

    const rl = readline.createInterface({ input: proc.stdout });
    rl.on("line", (line: string) => {
      try {
        const evt = JSON.parse(line) as SttEvent;
        handleSttEvent(evt);
      } catch {
        // ignore invalid lines
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      recorderState.lastStderr = recorderState.lastStderr
        ? `${recorderState.lastStderr}\n${msg}`
        : msg;
      const status = `STT error: ${recorderState.lastStderr}`;
      statusText.content = status;
      console.log(status);
      renderer.requestRender();
    });

    proc.on("error", (err) => {
      const msg = `Failed to start STT helper: ${err.message}`;
      statusText.content = msg;
      console.log(msg);
      renderer.requestRender();
    });

    proc.on("exit", (code, signal) => {
      if (state.isRecording) {
        state.isRecording = false;
        const detail =
          recorderState.lastStderr ||
          (code !== null
            ? `code ${code}`
            : signal
            ? `signal ${signal}`
            : "stt helper exited");
        const msg = `Recording stopped (${detail}).`;
        statusText.content = msg;
        console.log(msg);
        renderer.requestRender();
      }
    });
  }

  function stopRecorder(): void {
    const rec = state.recorder;
    if (!rec) return;
    rec.proc.kill("SIGTERM");
    state.recorder = undefined;
  }

  function handleSttEvent(evt: SttEvent): void {
    if (evt.type === "partial") {
      state.lastPartial = evt.text;
      refreshPromptView();
    } else if (evt.type === "final") {
      appendFinalText(evt.text);
    } else if (evt.type === "error") {
      statusText.content = `STT error: ${evt.error}`;
      renderer.requestRender();
    }
  }

  function buildRecorderArgs(modelPath: string): string[] {
    const helperPath = resolve(DIRNAME, "../../scripts/stt-helper.cjs");
    const args = [helperPath, "--model", modelPath, "--sample-rate", "16000"];
    if (process.env.STT_DEVICE) {
      args.push("--device", process.env.STT_DEVICE);
    }
    return args;
  }

  function buildWindowName(promptId?: number): string {
    if (promptId) return `codex-${promptId}`;
    return `codex-${Date.now().toString(36)}`;
  }

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    // ctrl+c
    if (key.raw === "\u0003") {
      shutdown();
      return;
    }

    if (state.historyOpen && historyList.handleKeyPress?.(key)) {
      return;
    }

    if (state.isEditing) {
      if (key.name === "escape" || (key.ctrl && key.name === "q")) {
        exitEdit();
      } else if (key.ctrl && key.name === "s") {
        key.preventDefault?.();
        state.currentPrompt = promptEditor.plainText;
        handleSave();
        exitEdit();
      }
      return;
    }

    if (key.name === "escape") {
      exitEdit();
      return;
    }

    switch (key.name) {
      case "r":
        toggleRecording();
        break;
      case "e":
        if (key.ctrl) enterEdit();
        break;
      case "i":
        handleXdotoolInject();
        break;
      case "s":
        handleSave();
        break;
      case "y":
        handleCopy();
        break;
      case "h":
        toggleHistory();
        break;
      case "c":
        handleCodexLaunch();
        break;
      case "q":
        shutdown();
        break;
    }
  });

  refreshPromptView();

  function shutdown(): void {
    stopRecording();
    renderer.destroy();
    process.exit(0);
  }

  function handleCopy(): void {
    const prompt = state.currentPrompt.trim();
    if (!prompt) {
      statusText.content = "Nothing to copy – prompt is empty.";
      renderer.requestRender();
      return;
    }
    const clipResult = copyToClipboard(prompt);
    statusText.content = clipResult ?? "Prompt copied to clipboard.";
    renderer.requestRender();
  }

  function handleXdotoolInject(): void {
    const prompt = state.currentPrompt.trim();
    if (!prompt) {
      statusText.content = "Nothing to inject – prompt is empty.";
      renderer.requestRender();
      return;
    }
    const target = process.env.XDO_WINDOW_ID;
    if (!target) {
      statusText.content = "Set XDO_WINDOW_ID to target window id (xdotool search...).";
      renderer.requestRender();
      return;
    }
    if (!hasXdotool()) {
      statusText.content = "xdotool not found in PATH.";
      renderer.requestRender();
      return;
    }
    const res = spawnSync("xdotool", [
      "windowactivate",
      "--sync",
      target,
      "key",
      "ctrl+a",
      "ctrl+k",
      "type",
      "--delay",
      "0",
      prompt,
      "key",
      "Return",
    ]);
    if (res.error || res.status !== 0) {
      statusText.content = `Inject failed: ${res.stderr?.toString().trim() || res.error?.message || res.status}`;
    } else {
      statusText.content = "Injected prompt via xdotool.";
    }
    renderer.requestRender();
  }
}

function buildLayout(renderer: Awaited<ReturnType<typeof createCliRenderer>>) {
  const layoutBox = new BoxRenderable(renderer, {
    id: "layout",
    flexDirection: "row",
    gap: 1,
    padding: 1,
    width: "100%",
    height: "100%",
    shouldFill: true,
  });

  const mainColumn = new BoxRenderable(renderer, {
    id: "main",
    flexDirection: "column",
    flexGrow: 1,
    gap: 1,
    shouldFill: true,
    padding: 1,
    backgroundColor: "#0B1220",
  });

  const title = new TextRenderable(renderer, {
    id: "title",
    content: "GLU CODE — Linux Voice -> Code",
    fg: "#E2E8F0",
    height: 1,
  });
  mainColumn.add(title);

  const promptBox = new BoxRenderable(renderer, {
    id: "prompt-box",
    border: true,
    borderColor: "#334155",
    backgroundColor: "#0B1220",
    padding: 1,
    flexDirection: "column",
    flexGrow: 1,
    shouldFill: true,
    title: "Current prompt",
    titleAlignment: "left",
  });

  const promptEditor = new TextareaRenderable(renderer, {
    id: "prompt-editor",
    height: "100%",
    wrapMode: "word",
    textColor: "#E2E8F0",
    backgroundColor: "transparent",
    focusedBackgroundColor: "#0F172A",
    focusedTextColor: "#F8FAFC",
    cursorColor: "#38BDF8",
    selectionBg: "#1E293B",
    selectionFg: "#E2E8F0",
    showCursor: false,
  });

  promptBox.add(promptEditor);
  mainColumn.add(promptBox);

  const statusText = new TextRenderable(renderer, {
    id: "status",
    content: "",
    fg: "#94A3B8",
    height: 1,
  });
  mainColumn.add(statusText);

  const hintText = new TextRenderable(renderer, {
    id: "hints",
    content:
      "R record · Ctrl+E edit · Ctrl+S save · Ctrl+Q exit edit · H history · C codex · Y copy · Q quit",
    fg: "#475569",
    height: 1,
  });
  mainColumn.add(hintText);

  const historyBox = new BoxRenderable(renderer, {
    id: "history",
    width: 36,
    border: true,
    borderColor: "#334155",
    backgroundColor: "#0B1220",
    title: "History (H)",
    titleAlignment: "center",
    flexDirection: "column",
    shouldFill: true,
    visible: true,
  });

  const historyList = new SelectRenderable(renderer, {
    id: "history-list",
    flexGrow: 1,
    backgroundColor: "transparent",
    focusedBackgroundColor: "transparent",
    selectedBackgroundColor: "#1E293B",
    textColor: "#CBD5E1",
    selectedTextColor: "#38BDF8",
    descriptionColor: "#64748B",
    selectedDescriptionColor: "#94A3B8",
    showScrollIndicator: true,
    wrapSelection: true,
    showDescription: true,
  });

  historyBox.add(historyList);
  const tmuxStatus = new TextRenderable(renderer, {
    id: "tmux-status",
    content: "",
    fg: "#94A3B8",
    height: 1,
    marginTop: 0,
    marginBottom: 0,
  });
  historyBox.add(tmuxStatus);
  layoutBox.add(mainColumn);
  layoutBox.add(historyBox);

  return { layoutBox, statusText, promptEditor, historyBox, historyList, promptBox, tmuxStatus };
}

function renderPromptPreview(state: AppState): string {
  const base = state.currentPrompt.trim();
  const partial = state.lastPartial?.trim();
  if (state.isRecording && partial) {
    return [base, partial].filter(Boolean).join(" ") + " …";
  }
  return base;
}

function defaultModelLocation(): string {
  return join(homedir(), ".local", "share", "vosk", "model");
}

interface RecorderProcess {
  proc: ReturnType<typeof spawn>;
  lastStderr?: string;
}

type SttEvent =
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "error"; error: string };

function attachFatalHandlers(
  renderer: Awaited<ReturnType<typeof createCliRenderer>>
): void {
  const cleanup = (code: number) => {
    try {
      renderer.destroy();
    } catch {
      // ignore
    }
    process.exit(code);
  };

  process.on("uncaughtException", (err) => {
    console.error("Fatal error:", err);
    cleanup(1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
    cleanup(1);
  });
}

function copyToClipboard(text: string): string | null {
  const candidates =
    process.env.WAYLAND_DISPLAY !== undefined
      ? [
          ["wl-copy", ["-n"]],
          ["xclip", ["-selection", "clipboard"]],
        ]
      : [
          ["xclip", ["-selection", "clipboard"]],
          ["wl-copy", ["-n"]],
        ];

  for (const [cmd, args] of candidates) {
    const res = spawnSync(cmd as string, args as string[], {
      input: text,
      encoding: "utf8",
    });
    if (!res.error && res.status === 0) {
      return null;
    }
  }
  return "Clipboard copy failed (wl-copy/xclip not found).";
}

function hasXdotool(): boolean {
  const res = spawnSync("xdotool", ["-v"]);
  return !res.error && res.status === 0;
}

function formatRun(run: RunRecord): string {
  const time = new Date(run.createdAt).toLocaleTimeString();
  const window = run.windowName ? ` tmux:${run.windowName}` : "";
  return `${time}${window}`;
}

function formatRunBrief(run: RunRecord): string {
  const date = new Date(run.createdAt);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}
