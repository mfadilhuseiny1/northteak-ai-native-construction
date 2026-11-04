"""The language the agents write in: chosen once for the app, told to every agent at the end of its instructions, and used for what code writes itself."""

from __future__ import annotations

import asyncio
import json

from fastapi.testclient import TestClient

from swarm import firm_api, language as L, llm, project as P


class Heard(llm.Scripted):
    """An agent that keeps the instructions it was given."""

    def __init__(self):
        super().__init__("mock/heard")
        self.system = ""

    def _reply(self, messages, tools):
        self.system = next((m["content"] for m in messages if m.get("role") == "system"), "")
        return super()._reply(messages, tools)

    def answer(self, results, tools):
        return "Done."


def test_every_agent_is_told_to_write_in_the_language_chosen():
    model = Heard()
    assert asyncio.run(llm.turn(model, "Read the drawing.", [], "Go.", 1)) == "Done."
    assert model.system.startswith("Read the drawing.") and model.system.endswith(L.RULES["en"]), "English, until someone picks Indonesian"
    L.choose("id")
    asyncio.run(llm.turn(model, "Read the drawing.", [], "Go.", 1))
    assert model.system.endswith(L.RULES["id"])


def test_what_is_quoted_and_named_from_the_documents_stays_as_they_have_it():
    """Code checks a quote against its page and finds a work package's pages by its name, so neither is translated."""
    for rule in L.RULES.values():
        assert "letter for letter" in rule and "quote" in rule and "work packages" in rule and "BoQ lines" in rule


def test_the_choice_is_kept_for_the_whole_app_and_checked(tmp_path, monkeypatch):
    monkeypatch.setattr(P, "SCENARIO_DB", tmp_path / "project.db")
    c = TestClient(firm_api.app)
    assert c.get("/api/language").json() == {"language": "en", "languages": {"en": "English", "id": "Indonesian"}}
    assert c.post("/api/language", json={"language": "fr"}).status_code == 409 and L.current() == "en"
    assert c.post("/api/language", json={"language": "id"}).json()["language"] == "id"
    assert c.get("/api/language").json()["language"] == "id" and L.current() == "id"


def test_what_code_writes_follows_the_choice():
    assert L.say("Order of work", "Urutan pekerjaan") == "Order of work"
    L.choose("id")
    assert L.say("Order of work", "Urutan pekerjaan") == "Urutan pekerjaan"


# ------------------------------------------------------------------------------------------------ the translator

from swarm import translator as T  # noqa: E402
from tests.test_modules import _close, records, template  # noqa: E402, F401 - each test on its own copy of the records


class Translating(llm.Scripted):
    """A translator that marks each text it was given, so a test can tell a translation from what was on file."""

    def __init__(self):
        super().__init__("mock/translator", tokens=50)
        self.system = ""
        self.texts: list[dict] = []

    def _reply(self, messages, tools):
        self.system = next((m["content"] for m in messages if m.get("role") == "system"), "")
        self.texts = json.loads(next(m["content"] for m in messages if m.get("role") == "user"))["texts"]
        return super()._reply(messages, tools)

    def answer(self, results, tools):
        return json.dumps({"texts": [{"n": x["n"], "t": f"EN: {x['t']}"} for x in self.texts]})


def test_only_what_reads_as_the_other_language_is_sent():
    assert T.foreign("Berapa mutu kolom yang dipakai?", "en") and T.foreign("Konsultan Pengawas", "en")
    assert not T.foreign("Which concrete grade do the columns take?", "en") and not T.foreign("RFI-035", "en") and not T.foreign("A50", "en")
    assert T.foreign("Which concrete grade do the columns take?", "id") and not T.foreign("Berapa mutu kolom yang dipakai?", "id")


def test_the_translator_shows_what_is_on_file_in_the_language_chosen_and_changes_no_record(monkeypatch):
    rfi = P.add_rfi({"subject": "Mutu beton kolom", "question": "Berapa mutu beton kolom yang dipakai?", "to": "Konsultan Pengawas", "activity": ""}, "draft", P.SWARM)
    assert {"Mutu beton kolom", "Berapa mutu beton kolom yang dipakai?", "Konsultan Pengawas"} <= set(T.waiting())
    model = Translating()
    monkeypatch.setattr(T.llm, "muse", lambda *a, **k: model)
    done = asyncio.run(T.translate(T.waiting()))
    assert done["translated"] >= 3 and done["failed"] == 0 and done["usd"] > 0
    assert "Language:" not in model.system and "English" in model.system, "the translator is not told to keep the names it is there to translate"
    assert P.get("rfi", rfi["id"])["subject"] == "Mutu beton kolom", "no record changes"
    c = TestClient(firm_api.app)
    shown = next(r for r in c.get("/api/rfis").json()["rfis"] if r["id"] == rfi["id"])
    assert (shown["subject"], shown["to"]) == ("EN: Mutu beton kolom", "EN: Konsultan Pengawas") and shown["id"] == rfi["id"]
    assert not T.waiting(), "translated once"
    L.choose("id")
    shown = next(r for r in c.get("/api/rfis").json()["rfis"] if r["id"] == rfi["id"])
    assert shown["subject"] == "Mutu beton kolom", "in Indonesian, as it was written"


def test_quotes_are_never_translated():
    words = {"Beton K-300": "Concrete K-300"}
    assert T.swap({"quote": "Beton K-300", "name": "Beton K-300", "sources": [{"quote": "Beton K-300"}]}, words) == {"quote": "Beton K-300", "name": "Concrete K-300", "sources": [{"quote": "Beton K-300"}]}


def test_the_button_refuses_with_no_key_and_says_what_it_would_cost(monkeypatch):
    monkeypatch.setattr(T.config, "muse_ready", lambda: False)
    P.add_rfi({"subject": "Mutu beton kolom", "question": "Berapa mutu beton kolom yang dipakai?", "to": "Konsultan Pengawas", "activity": ""}, "draft", P.SWARM)
    c = TestClient(firm_api.app)
    seen = c.get("/api/project/translate").json()
    assert seen["waiting"] >= 3 and seen["usd"] > 0 and seen["language"] == "en" and not seen["running"]
    assert c.post("/api/project/translate").status_code == 409
