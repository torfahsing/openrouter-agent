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

- [Bun](https://bun.sh) runtime (`>= 1.1.0`)
- `OPENROUTER_API_KEY` set in environment

## Installation & Build

```bash
# Clone the repository
git clone https://github.com/torfahsing/openrouter-agent.git
cd openrouter-agent

# Install dependencies
bun install

# Run directly
bun run src/cli.ts --help

# Optional: compile standalone executable
bun run build
# outputs binary to bin/openrouter-agent
```

## Usage

```bash
# Print self-describing capability manifest
bun run src/cli.ts --capabilities

# Run a query with streaming NDJSON output
bun run src/cli.ts -j -m anthropic/claude-3.5-sonnet "Analyze this codebase"

# Restrict allowed tools (e.g. for read-only / spec roles)
bun run src/cli.ts --allowedTools file_read grep glob -j -p "Summarize src/agent.ts"

# Disable all tools and limit steps (e.g. for reviewer roles)
bun run src/cli.ts --allowedTools none --max-steps 1 -j -p "Review this diff"
```

## Testing

```bash
bun test
```

## License

MIT
