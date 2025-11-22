declare module "vosk" {
  interface RecognizerOptions {
    model: any
    sampleRate: number
    grammar?: string | string[]
  }

  export class Recognizer {
    constructor(options: RecognizerOptions)
    acceptWaveform(data: Buffer): boolean
    result(): unknown
    finalResult(): unknown
    partialResult(): unknown
    reset(): void
    free(): void
  }

  export class Model {
    constructor(modelPath: string)
    free(): void
  }

  export function setLogLevel(level: number): void
}

declare module "node-record-lpcm16" {
  interface RecordOptions {
    sampleRate?: number
    channels?: number
    threshold?: number
    audioType?: "wav" | "raw"
    device?: string
    endOnSilence?: boolean
    verbose?: boolean
  }

  interface RecorderInstance {
    stop: () => void
    stream: () => NodeJS.ReadableStream
  }

  export function record(options?: RecordOptions): RecorderInstance

  const defaultExport: {
    record: typeof record
  }

  export default defaultExport
}
