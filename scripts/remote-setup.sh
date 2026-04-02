#!/bin/sh
# remote-setup.sh — One-liner setup for connecting local Claude Code to a remote Agent Dashboard
#
# Usage:
#   curl -s https://your-dashboard.com/api/hooks/setup-info | sh
#
# Or with auth token:
#   curl -s "https://your-dashboard.com/api/hooks/setup-info?token=YOUR_KEY" | sh
#
# What it does:
#   1. Downloads hook-handler.js to ~/.claude-internal/agent-monitor/
#   2. Writes dashboard URL + API token to ~/.claude-internal/claude-dashboard.json
#   3. Patches ~/.claude-internal/settings.json with hook entries
#
# No project clone needed — hook-handler.js is zero-dependency (Node.js built-ins only).
#
# To uninstall:
#   rm -rf ~/.claude-internal/agent-monitor
#   rm ~/.claude-internal/claude-dashboard.json
#   Then manually remove hook entries from settings.json, or run install-hooks.js --uninstall
