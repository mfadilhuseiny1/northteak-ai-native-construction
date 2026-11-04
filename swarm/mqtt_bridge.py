"""The building's MQTT broker, forwarded to the digital twin.

A building management system or an IoT gateway publishes each reading to its device's own topic on the building's broker:

    northteak/<project>/<floor>/<system>/<device>/<metric>

as a number, true or false, or {"value": 23.5, "at": "2026-11-04T10:00:00+07:00"}. Without "at", a reading is stamped when the app takes it.
A time without its zone is read as this computer's time, so a gateway that keeps UTC must say so, with Z, or its devices look hours old.
This bridge subscribes to northteak/<project>/# and posts what arrives to /api/project/twin/readings, five seconds' worth at a time, naming the
project: the app refuses readings for a project that is not the one open, so a broker never writes into another project. The app runs no
broker of its own, and the bridge keeps nothing: a reading the app could not take is said, not retried.

    .venv\\Scripts\\python -m swarm.mqtt_bridge mqtts://user:password@broker.example:8883

mqtt:// connects without TLS, on 1883 unless a port is given. The password can also come from MQTT_PASSWORD, so it stays out of the command
line. When the app has accounts, --email signs in as a Site account, with its password from NORTHTEAK_PASSWORD or asked for.
"""

from __future__ import annotations

import argparse
import getpass
import json
import math
import os
import queue
import sys
import time
from urllib.parse import unquote, urlparse

import httpx
import paho.mqtt.client as mqtt

ROOT = "northteak"
WORDS = {"true": 1.0, "false": 0.0, "on": 1.0, "off": 0.0}
GATHER = 5.0  # seconds of readings sent as one post: taking a post checks every device of the twin, which takes most of a second


def reading_of(topic: str, payload: bytes) -> dict | str:
    """The reading one message carries, or why it carries none. The device and the metric are the topic's last two levels."""
    parts = topic.split("/")
    if len(parts) < 4 or parts[0] != ROOT:
        return f"{topic}: not a {ROOT}/<project>/.../<device>/<metric> topic"
    text = payload.decode("utf-8", "replace").strip()
    try:
        value = json.loads(text)
    except ValueError:
        value = text
    at = ""
    if isinstance(value, dict):
        at = str(value.get("at") or "")
        value = value.get("value")
    if isinstance(value, str):
        value = WORDS.get(value.lower(), value)
    if isinstance(value, bool):
        value = float(value)
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        return f"{topic}: {text[:40]!r} is not a number, true or false"
    return {"device": parts[-2], "metric": parts[-1], "value": float(value), "at": at}


def forward(api: httpx.Client, project: str, batch: list[dict]) -> str:
    """Posts readings for one project, and says what became of them."""
    many = f"{len(batch)} reading{'' if len(batch) == 1 else 's'}"
    try:
        r = api.post("/api/project/twin/readings", params={"project": project}, json=batch)
    except httpx.HTTPError as e:
        return f"the app did not answer ({type(e).__name__}), so {many} were lost"
    if r.status_code == 401:
        raise SystemExit("The app has accounts: run the bridge again with --email of a Site account.")
    if r.status_code != 200:
        why = r.json().get("detail") if r.headers.get("content-type", "").startswith("application/json") else r.text[:200]
        return f"{many} refused: {why}"
    done = r.json()
    return f"{done['kept']} kept" + (f"; not a device and metric of this project: {', '.join(done['refused'][:5])}" if done["refused"] else "")


def broker_of(url: str) -> dict:
    """Where the broker is, from mqtt://user:password@host:port or mqtts:// for TLS."""
    u = urlparse(url if "://" in url else f"mqtt://{url}")
    if u.scheme not in ("mqtt", "mqtts") or not u.hostname:
        raise SystemExit(f"{url}: give the broker as mqtt://host:1883 or mqtts://host:8883")
    return {"host": u.hostname, "port": u.port or (8883 if u.scheme == "mqtts" else 1883), "tls": u.scheme == "mqtts",
            "user": unquote(u.username or ""), "password": unquote(u.password or "") or os.environ.get("MQTT_PASSWORD", "")}


def _say(line: str) -> None:
    print(f"{time.strftime('%H:%M:%S')}  {line}", flush=True)


def main(argv: list[str] | None = None) -> int:
    ask = argparse.ArgumentParser(prog="python -m swarm.mqtt_bridge", description="Forwards a building's MQTT readings to the digital twin.")
    ask.add_argument("broker", help="mqtt://[user[:password]@]host[:port], or mqtts:// for TLS")
    ask.add_argument("--api", default="http://127.0.0.1:8300", help="where the app's API is (default %(default)s)")
    ask.add_argument("--project", help="the project as its topics name it, northteak/<project>/... (default: the project open in the app)")
    ask.add_argument("--email", help="a Site account, when the app has accounts")
    args = ask.parse_args(argv)
    where = broker_of(args.broker)
    api = httpx.Client(base_url=args.api.rstrip("/"), timeout=60)
    if args.email:
        r = api.post("/api/auth/login", json={"email": args.email, "password": os.environ.get("NORTHTEAK_PASSWORD") or getpass.getpass(f"Password for {args.email}: ")})
        if r.status_code != 200:
            raise SystemExit(f"Signing in to the app failed: {r.text[:200]}")
    project = args.project
    if not project:  # as the open project's topics name it
        try:
            r = api.get("/api/project/twin")
        except httpx.HTTPError as e:
            raise SystemExit(f"The app's API did not answer at {args.api} ({e}). Start the app first, or give --api.") from e
        if r.status_code == 401:
            raise SystemExit("The app has accounts: run the bridge again with --email of a Site account.")
        devices = r.json().get("devices") or []
        if not devices:
            raise SystemExit("The project open in the app has no digital twin yet: its 3D model needs work packages with floors.")
        project = devices[0]["topic"].split("/")[1]
    topic = f"{ROOT}/{project}/#"
    arrived: queue.Queue[dict] = queue.Queue()

    def connected(client, _data, _flags, reason, _props) -> None:
        if reason.is_failure:
            _say(f"the broker refused the connection: {reason}")
            return
        client.subscribe(topic, qos=1)  # again after every reconnect: a clean session forgets it
        _say(f"connected to {where['host']}:{where['port']}, listening on {topic}")

    def message(_client, _data, msg) -> None:
        got = reading_of(msg.topic, msg.payload)
        if isinstance(got, str):
            _say(got)
        else:
            arrived.put(got)

    def lost(_client, _data, _flags, reason, _props) -> None:
        if reason.is_failure:
            _say(f"lost the broker ({reason}), trying again")

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect = connected
    client.on_message = message
    client.on_disconnect = lost
    if where["user"]:
        client.username_pw_set(where["user"], where["password"] or None)
    if where["tls"]:
        client.tls_set()
    try:
        client.connect(where["host"], where["port"])
    except OSError as e:
        raise SystemExit(f"Could not reach the broker at {where['host']}:{where['port']}: {e}") from e
    client.loop_start()
    try:
        while True:
            try:
                batch = [arrived.get(timeout=0.5)]  # never without a timeout: on Windows, Ctrl+C does not stop a wait that has none
            except queue.Empty:
                continue
            end = time.monotonic() + GATHER
            while (left := end - time.monotonic()) > 0:
                try:
                    batch.append(arrived.get(timeout=left))
                except queue.Empty:
                    break
            _say(forward(api, project, batch))
    except KeyboardInterrupt:
        return 0
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    sys.exit(main())
