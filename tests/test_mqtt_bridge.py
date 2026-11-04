"""The MQTT bridge: what a message on a device's topic becomes, and that the app takes it only for the project open. No broker is needed."""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from swarm import firm_api, mqtt_bridge as B, project as P
from tests.test_modules import _close, records, template  # noqa: F401 - each test on its own copy of the records

TOPIC = "northteak/pj-1/lt.-1/hvac/hvac-climate-001/temperature"


@pytest.mark.parametrize("payload, value, at", [(b"23.5", 23.5, ""), (b" 0 ", 0.0, ""), (b"true", 1.0, ""), (b"OFF", 0.0, ""),
                                                (b'{"value": 24, "at": "2026-11-04T10:00:00"}', 24.0, "2026-11-04T10:00:00"), (b'{"value": false}', 0.0, "")])
def test_a_message_is_a_reading_of_the_device_and_metric_its_topic_names(payload, value, at):
    assert B.reading_of(TOPIC, payload) == {"device": "hvac-climate-001", "metric": "temperature", "value": value, "at": at}


@pytest.mark.parametrize("topic, payload", [(TOPIC, b"warm"), (TOPIC, b"NaN"), (TOPIC, b'{"at": "2026-11-04"}'), (TOPIC, b""),
                                            ("other/pj-1/lt.-1/hvac/hvac-climate-001/temperature", b"1"), ("northteak/pj-1/temperature", b"1")])
def test_what_is_not_a_reading_says_why(topic, payload):
    assert isinstance(B.reading_of(topic, payload), str)


def test_the_app_takes_a_bridges_readings_only_for_the_project_open():
    c = TestClient(firm_api.app)
    device = c.get("/api/project/twin").json()["devices"][0]
    metric = device["metrics"][0]
    reading = B.reading_of(f"{device['topic']}/{metric}", b"1")
    assert device["topic"].split("/")[1] == P.DB.stem, "the topic names the project, which the bridge listens on"
    assert B.forward(c, P.DB.stem, [reading]) == "1 kept"
    assert c.get("/api/project/twin/readings").json()[device["id"]][metric]["value"] == 1, "the screen can ask for the readings alone"
    said = B.forward(c, "pj-another", [{**reading, "value": 5}])
    assert said.startswith("1 reading refused") and "pj-another" in said
    assert c.get("/api/project/twin/readings").json()[device["id"]][metric]["value"] == 1, "a reading for another project never lands in this one"
    assert B.forward(c, P.DB.stem, [reading, {**reading, "device": "nope"}]) == f"1 kept; not a device and metric of this project: nope/{metric}"


def test_the_bridge_says_what_was_lost_and_stops_when_it_must_sign_in():
    def down(request):
        raise httpx.ConnectError("refused", request=request)

    lost = B.forward(httpx.Client(transport=httpx.MockTransport(down), base_url="http://app"), "p", [{"device": "d", "metric": "m", "value": 1, "at": ""}] * 2)
    assert lost.startswith("the app did not answer") and "2 readings were lost" in lost
    signed_out = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(401, json={"detail": "Sign in first."})), base_url="http://app")
    with pytest.raises(SystemExit, match="--email"):
        B.forward(signed_out, "p", [{"device": "d", "metric": "m", "value": 1, "at": ""}])


def test_the_broker_is_read_from_its_url(monkeypatch):
    monkeypatch.delenv("MQTT_PASSWORD", raising=False)
    assert B.broker_of("mqtts://bms:p%40ss@broker.example") == {"host": "broker.example", "port": 8883, "tls": True, "user": "bms", "password": "p@ss"}
    assert B.broker_of("broker.local") == {"host": "broker.local", "port": 1883, "tls": False, "user": "", "password": ""}
    monkeypatch.setenv("MQTT_PASSWORD", "secret")
    assert B.broker_of("mqtt://bms@10.0.0.5:1884")["password"] == "secret", "kept out of the command line"
    with pytest.raises(SystemExit):
        B.broker_of("http://broker.example")
