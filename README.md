# Zig Docs MCP

MCP server providing up-to-date Zig documentation and builtin functions.

## Installation

### Claude Code
```bash
claude mcp add zig-docs npx -y zig-docs-mcp --version master --update-policy manual
```

### Claude Desktop
Add to your MCP configuration:
```json
{
  "mcpServers": {
    "zig-docs": {
      "command": "npx",
      "args": ["-y", "zig-docs-mcp", "--version", "master", "--update-policy", "manual"]
    }
  }
}
```

## Tools

- **`list_builtin_functions`** - Lists all available Zig builtin functions. Builtin functions are provided by the compiler and are prefixed with '@'. The comptime keyword on a parameter means that the parameter must be known at compile time. Use this to discover what functions are available, then use 'get_builtin_function' to get detailed documentation.
- **`get_builtin_function`** - Search for Zig builtin functions by name and get their documentation, signatures, and usage information. Returns all matching functions ranked by relevance.

## Commands

The CLI provides flexible options for version control and update management:

```bash
# Start MCP server with defaults (master branch, manual updates)
zig-docs-mcp

# Use specific Zig version
zig-docs-mcp --version 0.13.0

# Enable automatic daily updates
zig-docs-mcp --update-policy daily

# Update documentation without starting server
zig-docs-mcp update --version 0.14.1
```

**Version options**:
- `master` (default) - Latest development version from Zig's master branch
- `0.13.0`, `0.12.0`, etc. - Specific Zig release versions

**Update policies**:
- `manual` (default) - No automatic updates, manual control only
- `daily` - Check for documentation updates once per day
- `startup` - Update documentation every time the server starts

## Cache

Documentation is fetched from ziglang.org and cached in platform-specific directories:
- Linux: `~/.cache/zig-docs-mcp/`
- macOS: `~/Library/Caches/zig-docs-mcp/`
- Windows: `%LOCALAPPDATA%\zig-docs-mcp\`
