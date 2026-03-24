# viz — Claude Code Visualization Skill

Turn any codebase, topic, or conversation into an interactive visual map you can click through. Type `/viz` and Claude generates a diagram in your browser — click any piece to zoom in, ask questions in plain English, and navigate back.

No technical knowledge required to use it.

## What it looks like

- A clickable map opens in your browser
- Each box represents a piece of your codebase or topic
- Click any box to go deeper — Claude explains what's inside
- Hit **Back** to return to the previous view
- Use the **? Ask** button to ask questions in plain English

## Installation

### 1. Clone into the Claude skills folder

```bash
git clone https://github.com/zibogong/viz-skill ~/.claude/skills/viz
```

### 2. Install dependencies

```bash
cd ~/.claude/skills/viz && npm install
```

### 3. Register the server with Claude Code

```bash
claude mcp add --scope user viz -- node ~/.claude/skills/viz/server.mjs
```

Confirm it's registered:

```bash
claude mcp list
# Should show: viz: node ~/.claude/skills/viz/server.mjs
```

### 4. Start Claude Code with viz enabled

```bash
claude --dangerously-load-development-channels server:viz
```

> You need this flag every time you want to use viz. It tells Claude Code to activate the visualization channel.

## How to use

Once Claude Code is running with the flag above:

```
/viz
```

Claude will open a visualization in your browser at `http://localhost:3747/`.

**The green dot** in the top bar means the live channel is connected — clicks go directly to Claude.

**Click any card** to drill down. Claude reads the relevant files and renders a focused view in the same window. Hit **Back** to go up a level.

**The ? Ask button** (bottom-right corner) opens a chat panel. Ask anything about what you're looking at — Claude answers without changing your current view.

## Troubleshooting

**Grey dot / "Channel offline" in the banner**

Claude Code was started without the `--dangerously-load-development-channels server:viz` flag. Restart with it.

**`viz: Failed to connect` in `claude mcp list`**

Same fix — restart Claude Code with the flag above.

**Clicking a card does nothing / spinner disappears**

The viz channel may not be connected. Check the top banner — if it says "Channel offline", restart Claude Code with the flag.

## How it works (technical)

The skill has two parts:

- **`server.mjs`** — a local server (port 3747) that bridges browser clicks into Claude Code and streams responses back in real time
- **`SKILL.md`** — instructions Claude follows to generate visualizations and respond to clicks

```
~/.claude/skills/viz/
├── SKILL.md        ← Claude's instructions for generating vizzes
├── server.mjs      ← Local bridge server (port 3747)
└── package.json    ← Dependencies
```

The server is registered globally so it works in any project without extra configuration per repo.
