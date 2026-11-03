"""A demo MCP server standing in for WhatsApp, Slack and Gmail: the case's messages, and drafts that are only ever stored.
To use real accounts, name real MCP servers in mcp.json, offering the same tools."""

from __future__ import annotations

import json

from mcp.server import FastMCP

try:
    from swarm.site_case import MESSAGES
except ModuleNotFoundError:  # run as a file, not as a module: the package root is one folder up
    import pathlib
    import sys

    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
    from swarm.site_case import MESSAGES

mcp = FastMCP("demo-messages")
DRAFTS: list[dict] = []


@mcp.tool()
def read_messages(channel: str = "", query: str = "") -> str:
    """Read messages. channel: whatsapp, slack, gmail or empty for all. query: words that must appear, empty for all."""
    words = query.lower().split()
    rows = [m for m in MESSAGES if (not channel or m["channel"] == channel) and all(w in (m["from"] + " " + m["text"]).lower() for w in words)]
    return json.dumps({"messages": rows})


@mcp.tool()
def draft_message(channel: str, to: str, text: str) -> str:
    """Store a draft. It is not sent: a person approves it first."""
    DRAFTS.append({"channel": channel, "to": to, "text": text})
    return json.dumps({"status": "draft", "number": len(DRAFTS), "sent": False})


if __name__ == "__main__":
    mcp.run()
