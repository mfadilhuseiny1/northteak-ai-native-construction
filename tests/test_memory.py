"""What the agents remember, and what remembering must never do. Offline: the word matcher is code, the store is on disk in a temp folder, and nothing here calls a model.

The claims in the code are held here: the cases the matcher's two cut-offs were chosen from (memory.FLOOR, module_agents.SAME_WORDS), nothing leaves the machine (tried with every connection refused), a decision stays decided until the figures behind it change, and memory is context and never evidence.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import sys
import textwrap
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from swarm import firm, firm_api, llm, memory, module_agents as A, modules as M, planner, planning_case as PC, project as P, site_case as C

ROOT = Path(__file__).resolve().parent.parent


def _close() -> None:
    if P._conn is not None:
        P._conn.close()
        P._conn = None


@pytest.fixture(scope="session")
def template(tmp_path_factory):
    saved, P.DB = P.DB, tmp_path_factory.mktemp("records") / "seed.db"
    P._db()
    path = P.DB
    _close()
    P.DB = saved
    return path


@pytest.fixture(scope="session")
def review(template, tmp_path_factory):
    """The scripted planning review, finished once."""
    saved, P.DB = P.DB, tmp_path_factory.mktemp("review") / "project.db"
    shutil.copy(template, P.DB)

    async def go():
        firm._emit.set(lambda e: None)
        f = planner.PlanningFirm(firm_api.model_of("mock", "plan"), 5, PC.BRIEF, mock=True)
        await f.engagement()
        return f

    delay, firm_api.MOCK_DELAY = firm_api.MOCK_DELAY, 0
    f = asyncio.run(go())
    firm_api.MOCK_DELAY = delay
    _close()
    P.DB = saved
    return f


@pytest.fixture(autouse=True)
def records(template, tmp_path, monkeypatch):
    """Each test on its own copy of the records, with its own memory folder beside them."""
    path = tmp_path / "project.db"
    shutil.copy(template, path)
    monkeypatch.setattr(P, "DB", path)
    monkeypatch.setattr(P, "SCENARIO_DB", path)
    monkeypatch.setattr(P, "TODAY", C.TODAY)
    yield path
    memory.close()


REPEAT_A = "Chase RFI-035: column starter bars clash with the MEP sleeve. The engineer owes the answer by 2026-09-30, and A50 starts on 2026-10-02 with no float."
REPEAT_B = "Follow up RFI-035 about the starter bar clash with the MEP sleeve; the engineer must answer by 2026-09-30 because A50 starts 2026-10-02 with no float."
OTHER = "Order plywood sheets for the formwork: 120 sheets at Rp 175,000 from the supplier, needed on site next week."


def test_the_word_matcher_calls_a_repeat_a_repeat_and_other_advice_not():
    assert memory.closeness(REPEAT_A, REPEAT_B) >= A.SAME_WORDS, "a model saying the same thing in new words must be recognised"
    assert memory.closeness(REPEAT_A, OTHER) < A.SAME_WORDS
    assert memory.closeness(REPEAT_A, REPEAT_A) == pytest.approx(1.0)
    assert memory.vector(REPEAT_A) == memory.vector(REPEAT_A), "the vectors are kept, so they cannot change from run to run"


def test_a_repeat_is_only_a_repeat_on_the_same_record_with_no_new_figure():
    known = memory.decided("documents", {"title": "Chase RFI-035", "why": "Column starter bars clash with the MEP sleeve. The engineer owes the answer by 2026-09-30.", "refs": ["RFI-035"], "state": "dismissed", "made": ""})
    assert known and known["kind"] == "dismissed"
    same = {"title": "Follow up RFI-035", "why": "The starter bar clash with the MEP sleeve: the engineer must answer by 2026-09-30.", "refs": ["RFI-035"]}
    assert A._repeats(same, known)
    assert not A._repeats({**same, "why": same["why"] + " It is already 47 days late."}, known), "a new figure means something changed"
    assert not A._repeats({**same, "refs": ["RFI-041"]}, known)


def test_nothing_leaves_the_machine():
    import importlib.util
    import os

    assert os.environ.get("MEM0_TELEMETRY") == "False", "set before mem0 is imported, in the only file that imports it"
    assert importlib.util.find_spec("fastembed") is None, "fastembed would download an embedding model from Hugging Face"
    memory.note("The engineer answers RFIs on Fridays.", "documents")
    assert isinstance(memory._store().embedding_model, memory.Words), "mem0 embeds with the word matcher, not a model"


def test_a_note_is_carried_to_the_agents_that_work_where_it_was_written():
    memory.note("Hold point HP-07 was signed late twice; book the engineer a week ahead.", "quality")
    assert [m["kind"] for m in memory.of("quality")] == ["note"]
    assert memory.of("wbs") == []
    hits = memory.recall("hold point signed by the engineer")
    assert hits and "HP-07" in hits[0]["text"] and hits[0]["score"] >= memory.FLOOR
    assert "HP-07" in A.lessons_for({"name": "Inspection lead", "peran": "inspects the work"})
    assert memory.brief([]) == "", "an agent with no memory gets the same instructions as before"


def test_a_dismissed_recommendation_is_not_asked_again_until_it_is_brought_back():
    out = asyncio.run(A.ask("quality", "mock"))
    open_items = [x for x in out["items"] if x["state"] == "open"]
    assert open_items, "the seeded project gives the quality agent something to say"
    i = out["items"].index(open_items[0])
    A.decide("quality", i, "dismiss")
    assert memory.decisions("quality"), "the decision is what is remembered"
    again = asyncio.run(A.ask("quality", "mock"))
    carried = next(x for x in again["items"] if x["title"] == open_items[0]["title"])
    assert carried["state"] == "dismissed", "it is shown as decided, not offered again"
    A.decide("quality", again["items"].index(carried), "reopen")
    assert memory.decisions("quality") == []
    fresh = asyncio.run(A.ask("quality", "mock"))
    assert next(x for x in fresh["items"] if x["title"] == open_items[0]["title"])["state"] == "open"


def test_forgetting_and_clearing_the_memory():
    row = memory.note("Rain stops the pour most Fridays in October.", "schedule")
    assert memory.status()["count"] == 1
    with pytest.raises(KeyError):
        memory.forget("no-such-memory")
    memory.forget(row["id"])
    assert memory.of() == []
    memory.note("Again, briefly.", "schedule")
    memory.clear()
    assert memory.of() == [] and not memory.folder().exists()


# ------------------------------------------------------------------------------------------------ nothing leaves the machine, proved rather than assumed


def _python(code: str) -> str:
    """A fresh process, because these claims are about what happens at import. The last line it printed."""
    r = subprocess.run([sys.executable, "-W", "ignore", "-c", textwrap.dedent(code)], cwd=ROOT, capture_output=True, text=True, timeout=180)
    assert r.returncode == 0, r.stderr[-800:]
    return r.stdout.strip().splitlines()[-1]


def test_mem0s_own_flag_stays_off_whatever_the_environment_says_and_however_the_app_is_imported():
    assert _python("""
        import os
        os.environ["MEM0_TELEMETRY"] = "True"
        from swarm import firm_api
        import mem0.memory.telemetry as t
        print(t.MEM0_TELEMETRY)
    """) == "False"


def test_every_connection_refused_and_recorded_and_nothing_even_tries(tmp_path):
    assert _python(f"""
        import pathlib, socket
        tried = []
        def refuse(*a, **k):
            tried.append(str(a[-1]))
            raise OSError("no network in this test")
        socket.socket.connect = lambda self, address: refuse(address)
        socket.socket.connect_ex = lambda self, address: refuse(address)
        socket.getaddrinfo = refuse
        socket.create_connection = refuse
        from swarm import memory, project as P
        P.DB = pathlib.Path(r"{tmp_path}") / "project.db"
        P.SCENARIO_DB = P.DB
        row = memory.note("Engineer needs 48 hours' notice for a hold point.", "quality")
        assert memory.recall("notice for a hold point") and memory.of("quality"), memory.status()
        memory.forget(row["id"])
        memory.clear()
        memory.close()
        print("tried", tried)
    """) == "tried []"


def test_what_is_remembered_survives_a_restart_and_still_matches(tmp_path):
    """Two processes: the vectors are kept, so they must come out the same in the next one."""
    start = f"""
        import pathlib
        from swarm import memory, project as P
        P.DB = pathlib.Path(r"{tmp_path}") / "project.db"
        P.SCENARIO_DB = P.DB
    """
    assert _python(start + """
        print(memory.note("Engineer needs 48 hours' notice for a hold point.", "quality")["id"])
        memory.close()
    """)
    assert _python(start + """
        print(memory.recall("Give notice for hold point HP-21")[0]["text"])
        memory.close()
    """).startswith("Engineer needs 48 hours")


def test_the_words_of_what_was_deleted_are_not_kept_in_a_history_file():
    memory.note("Anything at all.", "quality")
    assert list(memory.folder().rglob("*")) and not list(memory.folder().rglob("history*"))


# ------------------------------------------------------------------------------------------------ the word matcher: the cases its two cut-offs were chosen from


BEARS = [
    ("Give notice for hold point HP-21. Level 4 column rebar: work stops until it is signed, on 2026-10-09.", "Engineer needs 48 hours' notice for a hold point, not 24."),
    ("Close NCR-014 by 2026-10-06. Top mat spacing out by 40 mm over 6 m at grid C, Level 3 bays 3-4", "HP-07 failed inspection: Level 3 slab rebar, bays 3-4: top mat spacing out at grid C"),
    ("Chase RFI-035: MEP sleeve clash. Engineer owes the answer by 2026-10-04.", "RFI-035 answered: MEP sleeve clash with starter bars. Move the sleeve at grid E, starter bars stay."),
    ("Expedite PO-118: Concrete K-350, 120 m3. Needed 2026-10-06, promised 2026-10-07.", "Backup supplier mix was refused: no approved trial mix on file for K-350 concrete."),
    ("Renew K3 safety certificate: CV Bata Mandiri. It has expired. Renew it before more work is released.", "CV Bata Mandiri took six weeks to renew its K3 safety certificate last time."),
    ("Order Plywood formwork sheets (PR-12). Tasks O-1, O-2 need it from 2026-10-12.", "Plywood formwork reused three times saved a third of the sheets."),
    ("Programme PT Rangka on A50. The plan needs them for columns, and the programme names only the own crew.", "PT Rangka cannot start columns until the tower crane is free: 3 hours a day."),
    ("Withdraw PLAN-DWG-04 from the working set. PLAN-DWG-05 replaces it.", "PLAN-DWG-04 (Column layout) marked rejected: superseded by revision C, do not build from it."),
    ("Clear RFI-035. MEP sleeve clash holds 6 tasks, 2 of them critical.", "RFI-035 answered: MEP sleeve clash with starter bars. Move the sleeve at grid E."),
    ("Review Reinforcement: forecast over budget. Forecast over by Rp 12,000,000, with a cost index of 0.97.", "O-1 (Cut and bend rebar) took 2,600 kg of Reinforcement bar against 2,524.0 planned."),
]
DOES_NOT = [
    ("Give notice for hold point HP-21. Level 4 column rebar: work stops until it is signed, on 2026-10-09.", "Plywood formwork reused three times saved a third of the sheets."),
    ("Renew K3 safety certificate: CV Bata Mandiri. It has expired.", "RFI-035 answered: MEP sleeve clash with starter bars. Move the sleeve at grid E."),
    ("Review MEP and sanitary: forecast over budget. Forecast over by Rp 4,000,000, with a cost index of 0.98.", "Engineer needs 48 hours' notice for a hold point, not 24."),
    ("Expedite PO-124: Aluminium windows, Level 2. Needed 2026-10-06, promised 2026-10-08.", "The tower crane is only free 3 hours a day for the columns."),
    ("Close NCR-014 by 2026-10-06. Top mat spacing out by 40 mm over 6 m at grid C.", "Plywood formwork reused three times saved a third of the sheets."),
    ("Decide on work plan WBS-a1b2c3. Its tasks do not reach the board, the schedule or QA/QC until a person approves it.", "CV Bata Mandiri took six weeks to renew its K3 safety certificate last time."),
    ("Order Portland cement (PR-07). Tasks O-3 need it from 2026-10-14.", "NCR-012 closed: Level 1 brick bed joints too thick. What fixed it: Rebuilt two bays."),
    ("Clear what holds A60. Level 4 slab pour is held by HP-21.", "CV Bata Mandiri took six weeks to renew its K3 safety certificate last time."),
    ("Bring Aluminium windows forward. Tasks C-1 need it from 2026-10-08.", "Engineer needs 48 hours' notice for a hold point, not 24."),
    ("Pengecoran kolom dengan beton K-300", "Plywood formwork reused three times saved a third of the sheets."),
    ("Raise a variation. BoQ says 212 m2, the takeoff says 240 m2.", "The tower crane is only free 3 hours a day for the columns."),
    ("Workforce lead. Checks the crew is enough for the work each day.", "RFI-035 answered: MEP sleeve clash with starter bars. Move the sleeve at grid E."),
    ("Cost lead. Checks every figure against the BoQ and the rates.", "Engineer needs 48 hours' notice for a hold point, not 24."),
]
REPEATS = [
    ("Chase RFI-035: MEP sleeve clash. Engineer owes the answer by 2026-10-04.", "Follow up with the Engineer on RFI-035 about the MEP sleeve clash: the answer was due 2026-10-04."),
    ("Close NCR-014 by 2026-10-06. Top mat spacing out by 40 mm over 6 m at grid C.", "Get NCR-014 closed before 2026-10-06: top mat spacing is out by 40 mm over 6 m at grid C."),
    ("Expedite PO-118: Concrete K-350, 120 m3. Needed 2026-10-06, promised 2026-10-07.", "Push the supplier on PO-118 for K-350 concrete: promised 2026-10-07, needed 2026-10-06."),
    ("Withdraw PLAN-DWG-04 from the working set. PLAN-DWG-05 replaces it.", "Remove superseded drawing PLAN-DWG-04 from the working set, since PLAN-DWG-05 replaces it."),
    ("Give notice for hold point HP-21. Level 4 column rebar: work stops until it is signed.", "Book the engineer for hold point HP-21 on Level 4 column rebar, because work stops until it is signed."),
]
NOT_REPEATS = [
    ("Close NCR-014 by 2026-10-06. Top mat spacing out by 40 mm over 6 m at grid C.", "Re-inspect HP-07 once the NCR-014 rework is finished and book the engineer."),
    ("Chase RFI-035: MEP sleeve clash. Engineer owes the answer by 2026-10-04.", "Hold the A30 pour until RFI-035 settles where the sleeves go."),
    ("Expedite PO-118: Concrete K-350, 120 m3. Needed 2026-10-06, promised 2026-10-07.", "Cancel PO-118 and reorder from the backup plant with an approved trial mix."),
    ("Withdraw PLAN-DWG-04 from the working set. PLAN-DWG-05 replaces it.", "Check whether PLAN-DWG-05 changes the reinforcement quantities in the BoQ."),
    ("Give notice for hold point HP-21. Level 4 column rebar: work stops until it is signed.", "Move the HP-21 inspection date back to match the rebar delivery."),
]


@pytest.mark.parametrize("recommendation, lesson", BEARS)
def test_a_lesson_that_bears_on_a_recommendation_reaches_the_floor(recommendation, lesson):
    assert memory.closeness(recommendation, lesson) >= memory.FLOOR


@pytest.mark.parametrize("recommendation, lesson", DOES_NOT)
def test_a_lesson_that_does_not_stays_under_the_floor(recommendation, lesson):
    assert memory.closeness(recommendation, lesson) < memory.FLOOR


@pytest.mark.parametrize("said, again", REPEATS)
def test_the_same_advice_in_other_words_is_a_repeat(said, again):
    assert memory.closeness(said, again) >= A.SAME_WORDS


@pytest.mark.parametrize("said, other", NOT_REPEATS)
def test_different_advice_on_the_same_record_is_not(said, other):
    assert memory.closeness(said, other) < A.SAME_WORDS


def test_unrelated_lessons_stay_off_what_the_agents_really_recommend():
    """The real texts found what hand-written pairs did not: with too few slots, hash collisions alone reached the floor."""
    texts = [f"{x['title']} {x['why']} {' '.join(x['refs'])}" for k in A.BENCH for x in A.worked_out(k, A.records_of(k))]
    lessons = ["Plywood reused three times saved a third of the sheets.", "The client refuses night pours.", "Engineer asked for a toolbox talk every Monday.", "Tower crane is only free three hours a day for the columns.", "Lift motor room hatch opens outwards.", "Paint samples go to the owner before ordering.", "Pengecoran malam tidak diizinkan oleh warga sekitar.", "Water pump broke twice in the rainy season.", "Gate guard closes at nine sharp.", "Toilets on Level 2 flooded last time the riser was tested."]
    assert len(texts) > 20
    assert sum(memory.closeness(t, u) >= memory.FLOOR for t in texts for u in lessons) <= 1


def test_what_shares_a_word_or_a_neighbouring_record_stays_off_the_card():
    """Found on a real model's answer: a card about RFI-034 quoting a note on RFI-035, and "Hold A30 pour" quoting a note on hold points."""
    note = "RFI-035: the architect answers only on Fridays, so chase by Wednesday."
    hold = "Hold A30 pour to approved mix only until RFI-034 is answered A30 Pour Level 3 slab bays 3-4 starting 2026-10-06 is not ready with RFI-034 open and impact that mix register stands with no backup A30 RFI-034"
    assert memory.closeness(hold, note) < A.ON_A_CARD
    assert memory.closeness(hold, "Engineer needs 48 hours' notice for a hold point, not 24.") < A.ON_A_CARD
    assert memory.closeness("Chase RFI-034: Backup supplier mix Engineer owes the answer by 2026-10-09. Until answered, the mix register stands: no backup mix. RFI-034", note) < A.ON_A_CARD
    assert memory.closeness("Chase RFI-035 for grid E starter bar clash before Wednesday RFI-035 to the Engineer due 2026-10-09 blocks CV Rangka Beton starting Level 4 columns at grid E for A50 starting 2026-10-10. RFI-035", note) >= A.ON_A_CARD
    assert sum(memory.closeness(card, lesson) >= A.ON_A_CARD for card, lesson in BEARS) == len(BEARS) - 1, "and what belongs there still reaches it. The one that does not, the agents still read"


def test_a_shared_number_counts_for_little_and_a_shared_id_for_a_lot():
    """A shared ordinary word still counts: "Level" alone can bring two texts near the floor. That is the limit of matching words."""
    order = "Expedite PO-124: Aluminium windows, Level 2. Needed 2026-10-06, promised 2026-10-08."
    same, other = [memory.closeness(order, f"Toilets on Level {n} flooded last time the riser was tested.") for n in (2, 3)]
    assert abs(same - other) < 0.05, "the number barely moves it"
    assert memory.closeness("Delivered 120 m3 on 2026-10-06", "Rain stopped 120 m3 on 2026-10-06") < memory.closeness("Delivered PO-118 on Monday", "Rain stopped PO-118 on Monday")
    assert memory.closeness("Clear RFI-035", "RFI-035 was slow") >= memory.FLOOR


def test_text_with_no_words_and_text_in_another_script_are_kept_apart():
    assert memory.remember("!!!", "quality", "note") and memory.remember("ไม่ได้ ตรวจ", "quality", "note") and memory.status()["on"]
    assert memory.vector("!!!") != memory.vector("ไม่ได้ ตรวจ")
    assert [m["text"] for m in memory.recall("ไม่ได้ ตรวจ")] == ["ไม่ได้ ตรวจ"], "a text finds its own words, and not everything else no word was found in"
    assert memory.recall("hold point rebar") == []


# ------------------------------------------------------------------------------------------------ what people decided stays decided


def ask(module: str, mode: str = "mock") -> dict:
    return asyncio.run(A.ask(module, mode))


def test_the_offline_rules_still_send_a_person_to_the_screen_after_the_check():
    out = ask("kanban")
    assert out["items"] and out["dropped"] == 0
    assert all(x["action"]["type"] == "open" and x["action"]["go"] for x in out["items"])


def test_what_is_dismissed_makes_room_for_the_next_in_line():
    first = ask("tower")
    assert len(first["items"]) == A.MOST_ITEMS
    for i in range(len(first["items"])):
        A.decide("tower", i, "dismiss")
    again = ask("tower")
    fresh = [x["title"] for x in again["items"] if x["state"] == "open"]
    assert fresh and not set(fresh) & {x["title"] for x in first["items"]}, "what was held back comes forward"
    assert sum(x["state"] == "dismissed" for x in again["items"]) == len(first["items"])
    assert "already decided" in again["summary"]


def test_a_dismissal_holds_only_until_the_figures_behind_it_change():
    out = ask("documents")
    i = next(n for n, x in enumerate(out["items"]) if x["refs"][0] == "RFI-034")
    A.decide("documents", i, "dismiss")
    assert next(x for x in ask("documents")["items"] if x["refs"][0] == "RFI-034")["state"] == "dismissed"
    P.patch("rfi", "RFI-034", {"due": "2026-12-31"}, P.PM, "moved the due date")
    assert next(x for x in ask("documents")["items"] if x["refs"][0] == "RFI-034")["state"] == "open", "something changed, so it is asked again"


def test_work_accepted_is_not_put_on_the_board_twice_until_it_is_finished():
    out = ask("schedule")
    i = next(n for n, x in enumerate(out["items"]) if x["action"]["type"] == "work_item")
    title = out["items"][i]["title"]
    state = lambda: next(x for x in ask("schedule")["items"] if x["title"] == title)  # noqa: E731
    A.decide("schedule", i, "accept")
    first = P.get("advice", "schedule")["items"][i]["made"]
    row = state()
    assert row["state"] == "accepted" and row["made"] == first
    P.patch("work_item", first, {"status": "done"}, P.PM, "finished")
    assert state()["state"] == "open", "finished, and the rule still fires, so it is a new question"
    j = next(n for n, x in enumerate(P.get("advice", "schedule")["items"]) if x["title"] == title)
    A.decide("schedule", j, "accept")
    second = P.get("advice", "schedule")["items"][j]["made"]
    row = state()
    assert second != first and row["state"] == "accepted" and row["made"] == second, "it remembers the work now open, not the work already finished"
    assert len(memory.decisions("schedule")) == 1


def test_a_note_written_twice_is_kept_once_and_a_correction_replaces():
    assert memory.note("The gate closes at nine.", "tower")["id"] == memory.note("The  gate closes   at nine.", "tower")["id"]
    assert len(memory.of("tower")) == 1
    memory.remember("Old figure", "cost", "actuals", "WBS-1/O-1")
    memory.remember("New figure", "cost", "actuals", "WBS-1/O-1")
    assert [m["text"] for m in memory.of("cost")] == ["New figure"]


def test_a_lesson_goes_on_the_recommendation_it_bears_on_and_a_decision_is_not_a_lesson():
    memory.note("RFI-035: the architect answers only on Fridays, so chase by Wednesday.", "documents")
    memory.note("Plywood reused three times saved a third of the sheets.", "cost")
    cards = {x["title"]: [m["text"] for m in x["lessons"]] for x in ask("kanban")["items"]}
    assert any("Fridays" in t for t in cards["Clear RFI-035"]) and cards["Clear RFI-034"] == [], "on the record it names, and not its neighbour"
    assert all(len(lessons) <= 1 for lessons in cards.values())
    assert not [t for lessons in cards.values() for t in lessons if "Plywood" in t], "a collision must not put it on a card it has nothing to do with"
    A.decide("kanban", 0, "dismiss")
    assert not [m for x in ask("kanban")["items"] for m in x.get("lessons", []) if m["kind"] in memory.DECIDED]


def test_forgotten_means_gone_from_the_agents_the_cards_the_audit_trail_and_the_disk(tmp_path):
    word = "ZQXMARKER"
    row = A.note("documents", f"RFI-035: {word} the architect answers only on Fridays, so chase by Wednesday.")
    card = next(x for x in ask("documents")["items"] if "RFI-035" in x["refs"])
    assert any(word in m["text"] for m in card["lessons"]), "the card quotes it"
    A.forget(row["id"])
    assert memory.of() == [] and memory.recall(f"{word} architect Fridays") == []
    assert not [m for x in P.get("advice", "documents")["items"] for m in x.get("lessons", []) if word in m["text"]], "the card no longer does, before anyone asks again"
    memory.close()
    assert [f.name for f in tmp_path.rglob("*") if f.is_file() and word.encode() in f.read_bytes()] == []


def test_forgetting_a_dismissal_asks_the_question_again():
    ask("documents")
    A.decide("documents", 0, "dismiss")
    A.forget(P.get("advice", "documents")["items"][0]["memory"])
    assert P.get("advice", "documents")["items"][0]["state"] == "open"
    assert ask("documents")["items"][0]["state"] == "open"


# ------------------------------------------------------------------------------------------------ what people's actions teach, and what agents' do not


def test_what_people_do_teaches_the_agents_and_each_module_hears_its_own():
    i = P.add_inspection("Level 4 column rebar", "A50", "besi", "2026-10-09")
    P.inspection_result(i["id"], "fail", note="Cover short at grid B")
    ncr = P.get("inspection", i["id"])["ncr"]
    P.close_ncr(ncr, "Spacers added, then inspected again.")
    P.answer_rfi("RFI-035", "Move the sleeve 200 mm east: the starter bars stay.")
    M.decide_document("PLAN-DWG-S401-A", "rejected", "Superseded by revision B.")
    P.log(P.PM, "approved the recovery plan", "decision", "D-1", "option B. Keep the milestone.")
    said = {m["kind"]: m for m in memory.of()}
    assert set(said) == {"inspection", "ncr", "rfi", "document", "recovery"}
    assert said["inspection"]["module"] == "quality" and i["id"] in said["inspection"]["text"] and "Cover short" in said["inspection"]["text"]
    assert said["ncr"]["module"] == "quality" and "What fixed it: Spacers added" in said["ncr"]["text"]
    assert said["rfi"]["module"] == "documents" and "200 mm east" in said["rfi"]["text"]
    assert said["document"]["module"] == "documents" and "revision B" in said["document"]["text"]
    assert said["recovery"]["module"] == "schedule" and "option B" in said["recovery"]["text"]
    assert all(m["by"] == P.PM for m in said.values())


def test_a_document_approved_with_nothing_said_teaches_nothing():
    M.decide_document("PLAN-DWG-S401-A", "approved", "")
    assert memory.of() == []


def test_every_action_memory_listens_for_is_one_the_records_really_write():
    """If an audit line is reworded, memory would go quiet with nothing failing. This fails instead."""
    source = (ROOT / "swarm" / "project.py").read_text(encoding="utf-8") + (ROOT / "swarm" / "modules.py").read_text(encoding="utf-8")
    for action in memory.TEACHES:
        assert f'"{action}' in source, action


def test_an_agents_action_is_never_remembered():
    P.log(P.SWARM, "closed an NCR", "ncr", "NCR-014", "an agent said so")
    P.log(P.SWARM, "recorded an RFI answer", "rfi", "RFI-035", "an agent said so")
    assert memory.of() == [] and not memory.folder().exists()


def test_seeding_a_project_teaches_nothing():
    assert not memory.folder().exists() and memory.status()["count"] == 0


def test_a_plan_decided_with_a_reason_teaches_and_one_without_does_not(review):
    silent = P.record_plan("run-aaaaaa", review, "mock")
    P.decide_plan(silent["id"], "reject", "")
    assert memory.of("wbs") == []
    told = P.record_plan("run-bbbbbb", review, "mock")
    P.decide_plan(told["id"], "reject", "The crane cannot reach grid E.")
    assert [m["text"] for m in memory.of("wbs")] == [f"Rejected work plan {told['id']}: The crane cannot reach grid E."]


def test_actuals_teach_only_when_the_work_ran_over_and_a_correction_leaves_nothing_wrong_behind(review):
    rec = P.record_plan("run-aaaaaa", review, "mock")
    P.decide_plan(rec["id"], "approve", "")
    step = next(s for s in P.get("plan", rec["id"])["plan"]["steps"] if s["materials"])
    material = step["materials"][0]
    actuals = lambda: [m for m in memory.of("cost") if m["kind"] == "actuals"]  # noqa: E731
    P.plan_actual(rec["id"], step["id"], step["man_hours"], {material["key"]: material["gross"]})
    assert actuals() == [], "as planned: nothing to learn"
    P.plan_actual(rec["id"], step["id"], step["man_hours"] * 1.5, {material["key"]: material["gross"] * 1.2})
    [lesson] = actuals()
    assert step["id"] in lesson["text"] and "man-hours" in lesson["text"] and material["name"] in lesson["text"]
    P.plan_actual(rec["id"], step["id"], step["man_hours"], {material["key"]: material["gross"]})
    assert actuals() == [], "the figure was wrong, and so was the lesson"


# ------------------------------------------------------------------------------------------------ memory is context, never evidence


def _muse(monkeypatch, answer: str) -> list[str]:
    """A model that says this, with what it was told kept for reading."""
    told: list[str] = []

    async def turn(model, instruction, tools, prompt, calls, on_usage=None, gate=None):
        told.append(instruction)
        return answer

    monkeypatch.setattr(A.config, "muse_ready", lambda: True)
    monkeypatch.setattr(A.llm, "muse", lambda *a, **k: None)
    monkeypatch.setattr(A.llm, "turn", turn)
    return told


def test_what_only_memory_holds_cannot_be_cited(monkeypatch):
    """A memory could otherwise launder a figure: remembered once, then repeated as if the records said it."""
    memory.note("RFI-999 took 77 days last time.", "documents")
    good = {"title": "Chase RFI-035 today", "why": "It holds A50.", "refs": ["RFI-035"], "action": {"type": "none"}}
    _muse(monkeypatch, json.dumps({"summary": "s", "recommendations": [{"title": "Chase RFI-999", "why": "It is open.", "refs": ["RFI-999"], "action": {"type": "none"}}, {"title": "Chase RFI-035", "why": "Last time it took 77 days.", "refs": ["RFI-035"], "action": {"type": "none"}}, good]}))
    out = ask("documents", "muse")
    assert [x["title"] for x in out["items"]] == [good["title"]] and out["dropped"] == 2


def test_a_model_may_not_send_a_person_to_a_screen(monkeypatch):
    _muse(monkeypatch, json.dumps({"summary": "s", "recommendations": [{"title": "Look at RFI-035", "why": "It holds A50.", "refs": ["RFI-035"], "action": {"type": "open", "go": "anywhere"}}]}))
    assert ask("documents", "muse")["items"][0]["action"] == {"type": "none"}


def test_a_model_is_told_what_people_decided_and_learned_and_told_it_is_not_evidence(monkeypatch):
    told = _muse(monkeypatch, '{"summary": "s", "recommendations": []}')
    ask("documents", "muse")
    assert "What people" not in told[0] and "already decided" not in told[0], "with nothing remembered, the same instructions as before"
    out = ask("documents")
    A.decide("documents", 0, "dismiss")
    memory.note("The architect answers only on Fridays.", "documents")
    ask("documents", "muse")
    assert out["items"][0]["title"] in told[1] and "already decided" in told[1]
    assert "The architect answers only on Fridays." in told[1] and "not evidence" in told[1]
    memory.note("ZQXPROJECT the client refuses night work.", "tower")
    ask("documents", "muse")
    assert "ZQXPROJECT" in told[2], "a note for the whole project reaches every module's agent, whatever its words"


def test_a_model_repeating_a_dismissal_in_new_words_is_not_asked_again_unless_a_figure_is_new(monkeypatch):
    memory.decided("documents", {"title": "Chase RFI-035", "why": "Column starter bars clash with the MEP sleeve. The engineer owes the answer by 2026-09-30.", "refs": ["RFI-035"], "state": "dismissed", "made": ""})
    repeat = {"title": "Follow up RFI-035", "why": "The starter bar clash with the MEP sleeve: the engineer owes the answer by 2026-09-30.", "refs": ["RFI-035"], "action": {"type": "none"}}
    records = A.records_of("documents")
    monkeypatch.setattr(A, "records_of", lambda module: {**records, "figures": "2026-09-30 and 47"})
    _muse(monkeypatch, json.dumps({"summary": "One thing.", "recommendations": [repeat]}))
    out = ask("documents", "muse")
    assert out["items"][0]["state"] == "dismissed" and "already decided" in out["summary"]
    _muse(monkeypatch, json.dumps({"summary": "One thing.", "recommendations": [{**repeat, "why": repeat["why"] + " It is 47 days late."}]}))
    assert ask("documents", "muse")["items"][0]["state"] == "open", "a new figure means something changed"


# ------------------------------------------------------------------------------------------------ the swarm


def test_lessons_reach_the_swarm_by_line_of_work_and_the_control_towers_reach_everyone():
    memory.note("ZQXQUALITY spacing was out at the last pour.", "quality")
    memory.note("ZQXPROJECT the client refuses night work.", "tower")
    for team in (firm.roster()[0], planner.roster()[0]):
        for a in team:
            told = A.lessons_for(a)
            assert "ZQXPROJECT" in told, a["name"]
            assert ("ZQXQUALITY" in told) == (a["lini"] in ("quality", "qa")), a["name"]


def test_with_nothing_remembered_the_swarm_gets_the_same_instructions():
    f = firm.Firm(firm_api.model_of("mock"), 5, firm.BRIEF, "", mock=True)
    assert f.head(f.team["cost"]).endswith(firm.RULES) and not memory.folder().exists()


@pytest.mark.parametrize("kind", ["recovery", "plan"])
def test_a_real_run_hands_its_agents_the_lessons(monkeypatch, kind):
    memory.note("ZQXPROJECT the client refuses night work.", "tower")
    told: list[str] = []
    real = llm.turn

    async def spy(model, instruction, tools, prompt, calls, *a, **k):
        told.append(instruction)
        return await real(model, instruction, tools, prompt, calls, *a, **k)

    monkeypatch.setattr(llm, "turn", spy)
    monkeypatch.setattr(firm_api, "MOCK_DELAY", 0)

    async def go():
        firm._emit.set(lambda e: None)
        await (planner.PlanningFirm(firm_api.model_of("mock", "plan"), 5, PC.BRIEF, mock=True) if kind == "plan" else firm.Firm(firm_api.model_of("mock"), 5, firm.BRIEF, "", mock=True)).engagement()

    asyncio.run(go())
    carried = [t for t in told if "ZQXPROJECT" in t]
    assert len(told) > 10 and len(carried) > len(told) / 2, f"{len(carried)} of {len(told)}"
    assert all("not evidence" in t for t in carried)


# ------------------------------------------------------------------------------------------------ memory must never get in the way


def test_a_broken_memory_stops_nobody_says_why_and_recovers(monkeypatch):
    def broken():
        raise RuntimeError("Storage folder is already accessed by another instance")

    memory.folder().mkdir(parents=True, exist_ok=True)
    with monkeypatch.context() as m:
        m.setattr(memory, "_store", broken)
        n = P.raise_ncr("A defect", "besi", "A20", "2026-10-09")
        assert P.close_ncr(n["id"], "Fixed anyway.")["status"] == "closed", "a person's action still goes through"
        out = ask("quality")
        assert out["items"], "the agent still answers"
        A.decide("quality", 0, "dismiss")
        assert P.get("advice", "quality")["items"][0]["state"] == "dismissed"
        status = memory.status()
        assert not status["on"] and "already accessed" in status["problem"]
        with pytest.raises(ValueError, match="memory is not available"):
            memory.note("Something a person wanted kept.", "quality")
    assert memory.note("It works again.", "quality") and memory.status()["on"]


def test_many_threads_at_once_lose_nothing_and_never_deadlock():
    """mem0's stores fail when several threads use them, and the API runs requests on several. Each thread also writes records, in the order a person's action does."""
    errors: list[str] = []

    def worker(n: int) -> None:
        try:
            for i in range(10):
                memory.remember(f"Thread {n} lesson {i} on hold point HP-{n}", "quality", "note")
                memory.recall("hold point")
                memory.of("quality")
                ncr = P.raise_ncr(f"Defect {n}-{i}", "besi", "A20", "2026-10-09")
                P.close_ncr(ncr["id"], f"Fixed {n}-{i}")
        except Exception as e:  # noqa: BLE001
            errors.append(repr(e))

    threads = [threading.Thread(target=worker, args=(n,), daemon=True) for n in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(90)
    assert not any(t.is_alive() for t in threads), "a deadlock"
    assert errors == [] and memory.status()["on"], (errors[:2], memory.status())
    kinds = [m["kind"] for m in memory.of("quality")]
    assert kinds.count("note") == 60 and kinds.count("ncr") == 60


def test_two_requests_are_never_handed_the_same_id():
    """The record is written after its id is asked for. Handing the same one out twice lost records silently: the second overwrote the first."""
    first, second = P.next_id("ncr", 15), P.next_id("ncr", 15)
    assert first != second
    ids = [P.next_id("work_item") for _ in range(3)]
    assert len(set(ids)) == 3 and P.next_id("rfi", 36) == "RFI-036", "the numbering itself has not changed"


def test_after_a_reset_the_numbering_starts_as_it_did(client):
    first = P.next_id("ncr", 15)
    assert client.post("/api/project/reset", json={}).status_code == 200
    assert P.next_id("ncr", 15) == first


def test_one_projects_memory_is_never_read_on_another():
    memory.note("Only on the scenario.", "quality")
    P.create_project("Second project")
    assert memory.of() == [] and memory.recall("only on the scenario") == []
    memory.note("Only on the second.", "quality")
    P.open_project("scenario")
    assert [m["text"] for m in memory.of()] == ["Only on the scenario."]


# ------------------------------------------------------------------------------------------------ through the API


@pytest.fixture()
def client():
    return TestClient(firm_api.app)


def test_a_person_reads_writes_and_forgets_through_the_api(client):
    r = client.post("/api/project/memory", json={"text": "The gate closes at nine."})
    assert r.status_code == 200 and r.json()["module"] == "tower", "a note is for the whole project"
    assert client.post("/api/project/memory", json={"text": "x", "module": "nope"}).status_code == 404
    assert client.post("/api/project/memory", json={"text": "   "}).status_code == 409
    listed = client.get("/api/project/memory").json()
    assert [m["text"] for m in listed["memories"]] == ["The gate closes at nine."] and listed["status"]["on"]
    assert client.post("/api/project/memory/nope/forget", json={}).status_code == 404
    assert client.post(f"/api/project/memory/{r.json()['id']}/forget", json={}).status_code == 200
    assert client.get("/api/project/memory").json()["memories"] == []


def test_a_dismissal_is_brought_back_through_the_api(client):
    assert client.post("/api/project/agents/documents/ask", json={"mode": "mock"}).status_code == 200
    assert client.post("/api/project/agents/documents/0/reopen", json={}).status_code == 409, "only a dismissed one can be"
    assert client.post("/api/project/agents/documents/0/dismiss", json={}).status_code == 200
    assert client.post("/api/project/agents/documents/0/reopen", json={}).json()["items"][0]["state"] == "open"
    assert memory.decisions("documents") == []


def test_resetting_the_scenario_forgets_it_and_a_project_of_your_own_cannot_be_reset(client):
    client.post("/api/project/memory", json={"text": "From the last demo.", "module": "tower"})
    assert client.post("/api/project/reset", json={}).status_code == 200
    assert client.get("/api/project/memory").json()["status"]["count"] == 0 and not memory.folder().exists()
    P.create_project("Mine")
    client.post("/api/project/memory", json={"text": "Mine to keep.", "module": "tower"})
    assert client.post("/api/project/reset", json={}).status_code == 409
    assert client.get("/api/project/memory").json()["status"]["count"] == 1
