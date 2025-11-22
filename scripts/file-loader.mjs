import { extname } from "node:path"
import { fileURLToPath } from "node:url"

// Minimal loader to let Node/tsx import OpenTUI's .scm/.wasm assets by returning the on-disk path.
export async function load(url, context, nextLoad) {
  const ext = extname(new URL(url).pathname)
  if (ext === ".scm" || ext === ".wasm") {
    const path = fileURLToPath(url)
    return {
      format: "module",
      source: `export default ${JSON.stringify(path)};`,
      shortCircuit: true,
    }
  }
  return nextLoad(url, context)
}
