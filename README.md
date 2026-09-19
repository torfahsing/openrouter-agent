# openrouter-agent

Fast, standalone CLI coding agent powered by **OpenRouter** and built with **Bun**.
Conforms to the **SpecFlow Agent CLI Protocol (v1)**.

## Features

- **Any Model via OpenRouter**: Use Claude 3.5 Sonnet, GPT-4o, DeepSeek R1, Gemini 2.5 Pro, Llama 3.3, and hundreds of other models through OpenRouter.
- **SpecFlow Protocol v1**:
  - Self-describing capability discovery (`--capabilities`).
  - Streaming NDJSON events (`-j` / `--json`) for text, reasoning, tool execution, and cost accounting.
  - Strict tool allowance enforcement via `--allowedTools`.
- **Standard Tool Suite**:
  - Code & Filesystem: `file_read`, `file_write`, `file_edit`, `shell`, `grep`, `glob`, `list_dir`.
  - Research & Context: `openrouter:web_search`, `openrouter:web_fetch`, `openrouter:datetime`, `read_persisted_result`.
- **Accurate Cost & Token Metering**: Captures token counts and exact USD cost reported by OpenRouter.

## Requirements

- [Bun](https://bun.sh) runtime (`>= 1.1.0`) (only required if running from source; not needed for standalone binaries)
- `OPENROUTER_API_KEY` set in your environment

---

## Installation & Quick Start

### 1. From Source (Development)

```bash
git clone https://github.com/torfahsing/openrouter-agent.git
cd openrouter-agent
bun install

# Run directly via Bun (no build step needed)
bun run src/cli.ts --capabilities

# Compile local standalone binary
bun run build
# outputs binary to bin/openrouter-agent
```

### 2. SpecFlow Integration

To make the CLI available system-wide and in SpecFlow:

```bash
# Symlink into your user bin (already in $PATH)
ln -sf $(pwd)/bin/openrouter-agent ~/.local/bin/openrouter-agent

# Verify
openrouter-agent --capabilities
```

---

## Usage

```bash
# Print self-describing capability manifest
openrouter-agent --capabilities

# Run a query with streaming NDJSON output
openrouter-agent -j -m anthropic/claude-3.5-sonnet "Analyze this codebase"

# Restrict allowed tools (e.g. for read-only / spec roles)
openrouter-agent --allowedTools file_read grep glob -j -p "Summarize src/agent.ts"

# Disable all tools and limit steps (e.g. for reviewer roles)
openrouter-agent --allowedTools none --max-steps 1 -j -p "Review this diff"
```

---

## Cross-Platform Builds & GitHub Releases

### Automated Releases via GitHub Actions
Whenever a version tag is pushed (e.g. `v0.1.0`), GitHub Actions automatically tests, cross-compiles standalone binaries, generates `SHA256SUMS.txt`, and publishes a GitHub Release with assets for:
- `openrouter-agent-linux-x64` (Linux Intel / AMD 64-bit)
- `openrouter-agent-linux-arm64` (Linux ARM 64-bit)
- `openrouter-agent-darwin-arm64` (macOS Apple Silicon M1/M2/M3/M4)
- `openrouter-agent-darwin-x64` (macOS Intel)
- `openrouter-agent-windows-x64.exe` (Windows 64-bit)

To publish a new release:
```bash
git tag v0.1.0
git push origin v0.1.0
```

### Local Cross-Compilation
You can also cross-compile for any target platform directly from your machine using Bun:

```bash
# macOS Apple Silicon
bun build --compile --minify ./src/cli.ts --target=bun-darwin-arm64 --outfile dist/openrouter-agent-darwin-arm64

# Linux x64
bun build --compile --minify ./src/cli.ts --target=bun-linux-x64 --outfile dist/openrouter-agent-linux-x64

# Windows x64
bun build --compile --minify ./src/cli.ts --target=bun-windows-x64 --outfile dist/openrouter-agent-windows-x64.exe
```

---

## Testing

```bash
bun test
```

---

## License

MIT
