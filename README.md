# Zig Docs MCP

Model Context Protocol (MCP) server that provides up-to-date documentation for the Zig programming language standard library and builtin functions.

It uses the same approach as Zig's official autodoc (ziglang.org) by reading STD lib source files directly through a WASM module. However instead of returning HTML, it outputs Markdown which significantly reduces token usage.

> [!TIP]
> Add `use zigdocs` to your prompt if you want to explicitly instruct the LLM to use Zig docs tools. Otherwise, LLM will automatically decide when to utilize MCP tools based on the context of your questions.

<p align="center" width="100%">
  <img src="https://raw.githubusercontent.com/zig-wasm/.github/refs/heads/main/static/readme_mcp_1.gif" width="49%" />
  <img src="https://raw.githubusercontent.com/zig-wasm/.github/refs/heads/main/static/readme_mcp_2.gif" width="49%" />
</p>

## Installation

### Claude Code

Using Node:

```bash
claude mcp add zig-docs npx -y zig-mcp@latest --version master --update-policy manual
```

Using Bun:

```bash
claude mcp add zig-docs bunx zig-mcp@latest --version master --update-policy manual
```

### Roo Code

1. Click the **MCP** button in Roo Code
2. Select **"Edit Global MCP"** or **"Edit Project MCP"**
3. Add the following configuration:

Using Node:

```json
{
  "mcpServers": {
    "zig-docs": {
      "command": "npx",
      "args": ["-y", "zig-mcp@latest", "--version", "master", "--update-policy", "manual"]
    }
  }
}
```

Using Bun:

```json
{
  "mcpServers": {
    "zig-docs": {
      "command": "bunx",
      "args": ["zig-mcp@latest", "--version", "master", "--update-policy", "manual"]
    }
  }
}
```

### Augment Code

Navigate to **Settings → MCP Servers → Add Server**, or edit the configuration directly:

Using Node:

```json
{
  "mcpServers": {
    "zig-docs": {
      "command": "npx",
      "args": ["-y", "zig-mcp@latest", "--version", "master", "--update-policy", "manual"]
    }
  }
}
```

Using Bun:

```json
{
  "mcpServers": {
    "zig-docs": {
      "command": "bunx",
      "args": ["zig-mcp@latest", "--version", "master", "--update-policy", "manual"]
    }
  }
}
```

### Claude Desktop

Add to your MCP configuration:

Using Node:

```json
{
  "mcpServers": {
    "zig-docs": {
      "command": "npx",
      "args": ["-y", "zig-mcp@latest", "--version", "master", "--update-policy", "manual"]
    }
  }
}
```

Using Bun:

```json
{
  "mcpServers": {
    "zig-docs": {
      "command": "bunx",
      "args": ["zig-mcp@latest", "--version", "master", "--update-policy", "manual"]
    }
  }
}
```

## Tools

- **`list_builtin_functions`** - Lists all available Zig builtin functions. Builtin functions are provided by the compiler and are prefixed with '@'. The comptime keyword on a parameter means that the parameter must be known at compile time. Use this to discover what functions are available, then use 'get_builtin_function' to get detailed documentation.
- **`get_builtin_function`** - Search for Zig builtin functions by name and get their documentation, signatures, and usage information. Returns all matching functions ranked by relevance.
- **`search_std_lib`** - Search the Zig standard library for declarations by name. Returns a list of matching items with their fully qualified names. Use this to discover available types, functions, and constants in the standard library.
- **`get_std_lib_item`** - Get detailed documentation for a specific standard library item by its fully qualified name (e.g., "std.ArrayList.init"). Returns comprehensive documentation including function signatures, parameters, errors, examples, and source code. Set `get_source_file: true` to retrieve the entire source file where the item is implemented.

## Commands

The CLI provides flexible options for version control and update management:

```bash
# Start MCP server with defaults (master branch, manual updates)
zig-mcp

# Use specific Zig version
zig-mcp --version 0.13.0

# Enable automatic daily updates
zig-mcp --update-policy daily

# Update documentation without starting server
zig-mcp update --version 0.14.1

# Start local web server to view documentation
zig-mcp view --version 0.14.1
```

**Version options**:
- `master` (default) - Latest development version from Zig's master branch
- `0.14.1`, `0.14.0`, etc. - Specific Zig release versions

**Update policies**:
- `manual` (default) - No automatic updates, manual control only
- `daily` - Check for documentation updates once per day
- `startup` - Update documentation every time the server starts

## Cache

Documentation is fetched from ziglang.org and cached in platform-specific directories:
- Linux: `~/.cache/zig-mcp/`
- macOS: `~/Library/Caches/zig-mcp/`
- Windows: `%LOCALAPPDATA%\zig-mcp\`
