"""Messages over MCP: agents read channels and draft replies through MCP servers named in mcp.json, so a real Slack, WhatsApp or Gmail
server can replace the demo one without touching the agents. Nothing is ever sent from here: a reply is a draft until a person approves it.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from . import config

DEMO = {"demo_messages": {"command": sys.executable, "args": ["-m", "swarm.mcp_demo_server"]}}


def servers() -> dict:
    path = config.ROOT / "mcp.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8")).get("mcpServers") or DEMO
    return DEMO


class McpHub:
    """One session per server for the whole run; agents share them through plain function tools."""

    def __init__(self) -> None:
        self.sessions: dict[str, ClientSession] = {}
        self.tools: dict[str, str] = {}  # tool name -> server
        self._stack: list = []

    async def start(self) -> None:
        for name, s in servers().items():
            transport = stdio_client(StdioServerParameters(command=s["command"], args=s.get("args", []), env={**s.get("env", {}), "PYTHONPATH": str(config.ROOT), "PATH": _path()},
                                                          cwd=str(config.ROOT)))
            read, write = await transport.__aenter__()
            session = ClientSession(read, write)
            await session.__aenter__()
            await session.initialize()
            self._stack.extend([transport, session])
            self.sessions[name] = session
            for tool in (await session.list_tools()).tools:
                self.tools[tool.name] = name

    async def call(self, tool: str, **args) -> dict:
        server = self.tools.get(tool)
        if not server:
            return {"error": f"no connected MCP server offers {tool}"}
        result = await self.sessions[server].call_tool(tool, args)
        text = "".join(getattr(c, "text", "") for c in result.content)
        try:
            return {"server": server, **json.loads(text)}
        except ValueError:
            return {"server": server, "text": text}

    async def stop(self) -> None:
        for item in reversed(self._stack):
            try:
                await item.__aexit__(None, None, None)
            except Exception:  # noqa: BLE001 - closing what is left of a run
                pass
        self._stack.clear()


def _path() -> str:
    import os

    return os.environ.get("PATH", "") + (";" + str(Path(sys.executable).parent))
