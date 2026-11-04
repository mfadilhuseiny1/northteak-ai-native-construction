"""The equipment a package asks the contractor to bring, read by code from the documents of a real package, and its pictures, drawn by an agent's description and checked by SAM.

The documents are public tender documents in docs/. Without them, these tests are skipped. Nothing here calls a model: drawing and finding are scripted.
"""

from __future__ import annotations

import asyncio
import io
import json

import pytest
from PIL import Image

from swarm import config, equipment as E, package_firm as F
from tests.test_package import analyse, client, project_copy, uploaded  # noqa: F401 - the fixtures this module shares

UNAIR = """2. Memiliki kemampuan menyediakan peralatan utama
untuk pelaksanaan pekerjaan, yaitu:
No Nama Peralatan Utama Kapasitas Jumlah
1 Hydrolic Injection Pile Min. 420 Ton 1 Unit
2 Genset Min. 150 kVa 1 Unit
3 Excavator Min. 135 HP 1 Unit
4 Dump Truck Min. 7 m3 3 Unit
5 Concrete Pump Min. Lenght 30 m 1 Unit
6
Tower
Crane/Mobil
Crane
Min. 5 Ton 1 Unit

[diisi jenis, kapasitas, dan jumlah peralatan yang
disyaratkan sesuai ketentuan pada IKP 17.3.b]

3. Memiliki kemampuan menyediakan personel
1 Manajer Pelaksana 5 tahun 1 Orang"""
UNAIR_MOSQUE = """2. Memiliki kemampuan menyediakan peralatan
utama untuk pelaksanaan pekerjaan, yaitu:
No Jenis Kapasitas Jumlah
1 Hydrolic
injection
pile
- Min.
1
Unit
2 Genset Min. 20 kVa Min.1
3 Excavator - Min.1
4 Dump
Truck
Min. 7 m3 Min.3
5 Concrete
pump
Min. 15m Min.
1 unit
6 TC/MC - Min.
1
Unit
[diisi jenis, kapasitas, dan jumlah peralatan"""
KKP = """17. PERALATAN UTAMA YANG DIBUTUHKAN
a. 1 (satu) unit Alat Pancang HSPD Kapasitas Minimal 240 ton;
b. 1 (satu) unit Mobil Crane Kapasitas Minimal 20 ton;
c. 1 (satu) unit Escavator Kapasitas Minimal 0,93 m3;
f. 2 (dua) unit Concrete Vibrator, dengan Daya 5,5 - 7 HP.
Peralatan utama disampaikan dengan bukti kepemilikan berupa kwitansi"""
ANNEX = """DAFTAR PERALATAN UTAMA
No Nama Peralatan Utama*) Merk dan Tipe**) Kapasitas **) Jumlah **) Kondisi **)
1 Hydrolic Injection Pile �� Min. 420 Ton 1 Unit ���
2 Genset ...... Min. 150 kVa 1 Unit ......
Catatan:"""
UNP = """10. Spesifikasi Peralatan Konstruksi dan Peralatan Bangunan.
No Jenis Kapasitas Jumlah
1 Tower Crane 3000 Kg 1 Unit
2 Generator Set 50 KVA 1 Unit
3 Lift Barang 1,5 Ton 1 Unit
4 Exacavator 0,8 M3 1 Unit
5 Scafollding - 2000  Set
6 Vibrator beton 2 Unit
"""
SUPPORT = """5. Daftar Peralatan
No Jenis alat Spec Jumlah
A Peralatan Utama
1. Excavator PC 75 1 unit
2. Dump truck 4 m3 2 unit
B Peralatan Pendukung
.1 Mini Dozzer 5 ton 1 unit
8 Perancah PCH ls 500 set
14 Spot light 1000 watt 5 buah
15 Peralatan pengaman tenaga kerja
Daftar peralatan dilampirkan bukti:"""
SAM = "<0f>0<|box;x1=83;y1=126;x2=1601;y2=1083;w=1792;h=1344;c=0.8987342119216919|><|mask;x=0;y=0;c=0.8987342119216919;data=46,101,~abc|>"


def rows_of(page: str) -> list[tuple[str, str, str]]:
    return [(r["name"], r["spec"], r["quantity"]) for r in E.listed_on(page)]


@pytest.fixture
def shelf(tmp_path, monkeypatch):
    """Pictures kept in a folder of the test's own, never in assets/."""
    monkeypatch.setattr(E, "ASSETS", tmp_path / "equipment")
    return tmp_path / "equipment"


def picture(size=(1600, 1200)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, "#888888").save(out, "JPEG")
    return out.getvalue()


def test_the_list_is_read_from_the_documents_before_any_agent_runs(client, shelf):
    e = client.get("/api/project/equipment").json()
    by = {x["name"]: x for x in e["items"]}
    crane = by["Tower crane"]
    assert (crane["quantity"], crane["group"]) == ("1 unit", "main") and "60m" in crane["spec"] and "1,5 ton" in crane["spec"], "how many and how big, in the document's words"
    assert crane["page"] > 0 and "Tower Crane" in crane["quote"], "with the page it is on"
    assert by["Dump truck"]["quantity"] == "2 units" and by["Scaffolding"]["quantity"] == "500 sets" and by["Spotlight"]["quantity"] == "5 pieces"
    assert by["Mini dozer"]["group"] == "support" and by["Dump truck"]["group"] == "main", "the table's own two groups, across its page break"
    assert [x["group"] for x in e["items"]] == sorted((x["group"] for x in e["items"]), key=["main", "support"].index), "what matters most first"
    assert e["missing"] == len({x["picture"] for x in e["items"]}) and not any(x["drawn"] for x in e["items"]), "nothing is drawn yet, and a shared picture counts once"


def test_a_pre_bid_answer_is_on_the_machine_it_changes(client, shelf):
    by = {x["name"]: x for x in client.get("/api/project/equipment").json()["items"]}
    [dozer] = by["Mini dozer"]["answers"]
    assert "Bulldozer D60" in dozer["question"] and dozer["answer"] == "Boleh" and dozer["page"] > 0
    assert by["Scaffolding"]["answers"][0]["answer"].lower() == "boleh"
    assert by["Tower crane"]["answers"] == [], "no question was asked about it"


@pytest.mark.parametrize("page, rows", [
    (UNAIR, [("Hydraulic injection pile rig", "Min. 420 Ton", "1 unit"), ("Generator set", "Min. 150 kVa", "1 unit"), ("Excavator", "Min. 135 HP", "1 unit"), ("Dump truck", "Min. 7 m3", "3 units"), ("Concrete pump", "Min. Lenght 30 m", "1 unit"), ("Tower or mobile crane", "Min. 5 Ton", "1 unit")]),
    (UNAIR_MOSQUE, [("Hydraulic injection pile rig", "", "1 unit"), ("Generator set", "Min. 20 kVa", "1 unit"), ("Excavator", "", "1 unit"), ("Dump truck", "Min. 7 m3", "3 units"), ("Concrete pump", "Min. 15m", "1 unit"), ("Tower or mobile crane", "", "1 unit")]),
    (KKP, [("Hydraulic injection pile rig", "Min. 240 ton", "1 unit"), ("Mobile crane", "Min. 20 ton", "1 unit"), ("Excavator", "Min. 0,93 m3", "1 unit"), ("Concrete vibrator", "Daya 5,5 - 7 HP", "2 units")]),
    (ANNEX, [("Hydraulic injection pile rig", "Min. 420 Ton", "1 unit"), ("Generator set", "Min. 150 kVa", "1 unit")]),
    (UNP, [("Tower crane", "3000 Kg", "1 unit"), ("Generator set", "50 KVA", "1 unit"), ("Goods lift", "1,5 Ton", "1 unit"), ("Excavator", "0,8 M3", "1 unit"), ("Scaffolding", "", "2000 sets"), ("Concrete vibrator", "", "2 units")]),
])
def test_each_form_a_list_comes_in(page, rows):
    assert rows_of(page) == rows


def test_a_table_says_which_group_each_row_is_in():
    by = {r["name"]: r for r in E.listed_on(SUPPORT)}
    assert by["Dump truck"]["group"] == "main" and by["Mini dozer"]["group"] == "support" and by["Scaffolding"]["spec"] == "PCH"
    assert "Peralatan pengaman" not in " ".join(by), "safety gear has no number to rent"


@pytest.mark.parametrize("page", [
    "Peralatan utama yang ditempatkan adalah peralatan yang laik dan harus sesuai dengan Lampiran A SSKK.",
    "Pemasangan instalasi peralatan utama. Genset 1 unit harus diuji sebelum serah terima.",
    "Daftar peralatan\n1 Lampu Taman 3 unit\n2 Bangku Kayu 4 unit",
])
def test_a_sentence_or_a_list_of_other_things_is_not_equipment(page):
    assert E.listed_on(page) == []


def test_a_row_cannot_be_named_by_a_number():
    assert E._row("1 unit", "main") is None and E._row("12 34 1 unit", "main") is None


def test_another_list_that_differs_stands_beside_the_first_and_one_that_adds_nothing_does_not():
    docs = [{"id": "C", "title": "Contract", "kind": "contract", "pages_text": [UNAIR]}, {"id": "T", "title": "Tender", "kind": "tender", "pages_text": ["", UNAIR, UNAIR_MOSQUE]}]
    by = {r["name"]: r for r in E.listed(docs)}
    assert list(by) == ["Hydraulic injection pile rig", "Generator set", "Excavator", "Dump truck", "Concrete pump", "Tower or mobile crane"], "one row a machine"
    assert [(a["spec"], a["doc"], a["page"]) for a in by["Generator set"]["also"]] == [("Min. 20 kVa", "T", 3)], "with its own page, and code does not choose between them"
    assert by["Dump truck"]["also"] == [] and by["Excavator"]["also"] == [], "the same, or the same number with no size"


def test_prices_and_a_bidders_question_are_not_what_must_be_brought():
    docs = [{"id": "B", "title": "BoQ", "kind": "boq", "pages_text": [UNAIR]}, {"id": "M", "title": "Minutes", "kind": "clarification", "pages_text": [UNAIR]}]
    assert E.listed(docs) == []


def test_sam_passes_only_what_it_is_sure_of_and_what_is_the_subject():
    assert round(E.subject(SAM), 2) == 0.90
    assert E.subject("") is None, "an empty answer means it did not find it"
    assert E.subject(SAM.replace("c=0.8987342119216919", "c=0.2")) is None
    assert E.subject(SAM.replace(";c=0.8987342119216919|><|mask", "|><|mask")) is None, "no confidence, no pass"
    assert E.subject(SAM.replace("x2=1601;y2=1083", "x2=183;y2=226")) is None, "something small in the background"
    best = E.subject(f"{SAM.replace('c=0.8987342119216919', 'c=0.6')}\n<0f>1<|box;x1=0;y1=0;x2=900;y2=900;w=1792;h=1344;c=0.95|><|mask;x=0;y=0;data=1|>")
    assert best == 0.95


def test_a_picture_is_the_whole_drawing_with_its_stamp():
    drawing = Image.new("RGB", (1600, 1200), "#888888")
    drawing.paste("#ffffff", (0, 0, 1600, 100))  # what a crop to the machine lower down would lose
    out = io.BytesIO()
    drawing.save(out, "JPEG")
    img = Image.open(io.BytesIO(E.framed(out.getvalue())))
    assert img.size == E.SIDE and img.format == "JPEG"
    assert img.getpixel((E.SIDE[0] // 2, 5))[0] > 230, "the top of the drawing is still there"
    assert img.getpixel((5, E.SIDE[1] - 5))[0] < 60, "the stamp's strip is there"
    assert Image.open(io.BytesIO(E.framed(picture((1920, 1080))))).size == E.SIDE, "another shape still fills the card"


def script(monkeypatch, found) -> list[str]:
    """Muse draws anything, and SAM answers from the list given, drawing by drawing."""
    drawn = []

    async def draw(client, prompt):
        drawn.append(prompt)
        return picture()

    answers = iter(found)

    async def find(client, raw, phrase):
        return next(answers)

    monkeypatch.setattr(E, "_draw", draw)
    monkeypatch.setattr(E, "_find", find)
    return drawn


LOOKS = {"machines": [{"picture": "dozer", "looks": "A small tracked machine with a blade.", "find": "bulldozer"}]}
DOZER = {"picture": "dozer", "name": "Mini dozer", "spec": "5 ton", "words": "Mini Dozzer 5 ton 1 unit"}


def test_a_drawing_sam_cannot_find_it_in_is_drawn_again_closer(monkeypatch, shelf):
    drawn = script(monkeypatch, ["", SAM])
    done = asyncio.run(E.paint([DOZER], LOOKS))
    assert done["drawn"] == ["Mini dozer"] and done["failed"] == [] and len(drawn) == 2
    assert E.CLOSER not in drawn[0] and E.CLOSER in drawn[1] and "A small tracked machine" in drawn[0] and "no logos" in drawn[0]
    assert done["usd"] == round(2 * (E.IMAGE_USD + E.FIND_USD), 5), "both drawings and both checks are paid for"
    kept = json.loads((shelf / E.MANIFEST).read_text(encoding="utf-8"))["dozer"]
    assert (kept["drawings"], kept["find"], kept["drawn_by"], kept["checked_by"]) == (2, "bulldozer", "muse-image-1.0", "sam-3.1") and (shelf / "dozer.jpg").exists()


def test_sam_is_asked_in_plainer_words_when_it_does_not_know_the_trades(monkeypatch, shelf):
    asked = []
    script(monkeypatch, [])

    async def find(client, raw, word):
        asked.append(word)
        return SAM if word == "truck" else ""

    monkeypatch.setattr(E, "_find", find)
    done = asyncio.run(E.paint([DOZER], {"machines": [{"picture": "dozer", "looks": "A truck with a boom.", "find": ["concrete pump", "truck", "vehicle", "never asked"]}]}))
    assert asked == ["concrete pump", "truck"] and done["drawn"] == ["Mini dozer"], "it stops at the first it finds, and asks for three at most"
    assert E.pictures()["dozer"]["find"] == "truck", "the file says what it was found as"
    assert done["usd"] == round(E.IMAGE_USD + 2 * E.FIND_USD, 5)


@pytest.mark.parametrize("said, words", [
    (["rebar bending machine", "bar bender machine", "bending machine"], ["rebar bending machine", "bar bender machine", "machine"]),
    (["concrete pump", "pump truck", "truck"], ["concrete pump", "pump truck", "pump"]),
    (["excavator", "digger"], ["excavator", "digger"]),
    ("tower crane", ["tower crane", "crane"]),
    (["dump truck", "dump truck", "truck"], ["dump truck", "truck"]),
    ([], []),
])
def test_sam_is_always_asked_for_the_plain_word_the_agent_may_leave_out(said, words):
    assert E.words_for({"find": said}) == words


@pytest.mark.parametrize("said, words", [
    (["construction hoist", "goods hoist", "hoist"], ["construction hoist", "goods hoist", "cage"]),
    (["construction hoist", "goods lift"], ["construction hoist", "hoist", "cage"]),
    (["cage", "hoist"], ["cage", "hoist"]),
])
def test_a_machine_sam_knows_by_another_word_is_also_asked_for_by_it(said, words):
    assert E.words_for({"picture": "goods-lift", "find": said}) == words, "the one word SAM was measured to find, within three"


def test_a_machine_models_draw_wrongly_goes_to_the_agent_with_what_the_word_means(shelf):
    rows = [{"picture": "pile-rig", "name": "Hydraulic injection pile rig", "spec": "Min. 420 Ton", "quote": "Hydrolic Injection Pile Min. 420 Ton 1 Unit"}, {"picture": "excavator", "name": "Excavator", "spec": "", "quote": "Excavator 1 unit"}]
    pile, excavator = E.to_draw(rows)
    assert "no hammer" in pile["note"] and excavator["note"] == ""


def test_what_no_drawing_passes_stays_undrawn_and_says_why(monkeypatch, shelf):
    drawn = script(monkeypatch, [""] * E.TRIES)
    done = asyncio.run(E.paint([DOZER], LOOKS))
    assert len(drawn) == E.TRIES and done["drawn"] == [] and "bulldozer" in done["failed"][0]["why"] and not (shelf / "dozer.jpg").exists()
    assert E.pictures() == {}


def test_what_the_agent_did_not_describe_is_not_drawn(monkeypatch, shelf):
    drawn = script(monkeypatch, [])
    done = asyncio.run(E.paint([DOZER], {"machines": [{"picture": "other", "looks": "x", "find": "y"}, "junk"]}))
    assert drawn == [] and done["failed"] == [{"name": "Mini dozer", "why": "the agent did not describe it"}] and done["usd"] == 0


def test_a_picture_is_paid_for_once(monkeypatch, shelf):
    monkeypatch.setattr(config, "muse_ready", lambda: True)
    script(monkeypatch, [SAM])
    rows = [{**DOZER, "quote": DOZER["words"]}]
    asked = []

    async def ask(machines):
        asked.append(json.loads(machines))
        return LOOKS

    assert asyncio.run(E.draw(ask, rows))["drawn"] == ["Mini dozer"] and asked[0][0]["words"] == DOZER["words"], "the agent sees the document's own words"
    assert asyncio.run(E.draw(ask, rows)) == {"drawn": [], "failed": [], "usd": 0.0} and len(asked) == 1, "it is on file, for every project"


def test_the_button_refuses_with_no_key_and_serves_only_what_is_on_file(client, shelf, monkeypatch):
    monkeypatch.setattr(config, "muse_ready", lambda: False)
    r = client.post("/api/project/equipment/draw", json={})
    assert r.status_code == 409 and "META_API_KEY" in r.json()["detail"]
    shelf.mkdir()
    (shelf / "dozer.jpg").write_bytes(picture())
    (shelf / E.MANIFEST).write_text(json.dumps({"dozer": {}}), encoding="utf-8")
    assert client.get("/api/project/equipment/picture/dozer").headers["content-type"] == "image/jpeg"
    assert client.get("/api/project/equipment/picture/tower-crane").status_code == 404
    assert client.get("/api/project/equipment/picture/..%2Fmanifest").status_code == 404
    by = {x["picture"]: x["drawn"] for x in client.get("/api/project/equipment").json()["items"]}
    assert by["dozer"] is True and by["tower-crane"] is False


def test_an_offline_run_draws_nothing_and_finishes(client, shelf, monkeypatch):
    async def never(*_):
        raise AssertionError("an offline run must not pay for a picture")

    monkeypatch.setattr(E, "paint", never)
    analyse(client)
    stage = next(s for s in client.get("/api/aip/analysis").json()["stages"] if s["key"] == "equipment")
    assert stage["status"] == "done" and stage["by"] == "Equipment illustrator" and "offline" in stage["note"]
    assert E.pictures() == {}


def firm_with(monkeypatch, draw):
    f = F.PackageFirm(lambda *a: None, 1.0)
    stages = []
    monkeypatch.setattr(f, "stage", lambda key, status, **extra: stages.append((key, status, extra.get("note", ""))))
    monkeypatch.setattr(F.EQ, "missing", lambda: [DOZER])
    monkeypatch.setattr(F.EQ, "draw", draw)
    return f, stages


def test_a_run_pays_for_its_pictures_and_says_what_it_could_not_draw(monkeypatch):
    async def drew(ask):
        return {"drawn": ["Mini dozer"], "failed": [{"name": "Stamper", "why": "x"}], "usd": 0.05}

    f, stages = firm_with(monkeypatch, drew)
    asyncio.run(f.draw_equipment())
    assert round(f.spent, 2) == 0.05 and round(f.usage["illustrator"]["usd"], 2) == 0.05
    assert stages[-1][:2] == ("equipment", "done") and "1 picture drawn" in stages[-1][2] and "1 not: Stamper" in stages[-1][2]


@pytest.mark.parametrize("problem", [ValueError("no answer"), RuntimeError("stopped at the spending limit")])
def test_a_drawing_that_fails_never_stops_the_run(monkeypatch, problem):
    async def fails(ask):
        raise problem

    f, stages = firm_with(monkeypatch, fails)
    asyncio.run(f.draw_equipment())
    assert stages[-1][:2] == ("equipment", "done") and str(problem) in stages[-1][2] and f.spent == 0 and not f.stopped


def test_a_stopped_run_does_not_start_drawing(monkeypatch):
    async def never(ask):
        raise AssertionError("it was stopped")

    f, stages = firm_with(monkeypatch, never)
    f.stopped = "a person pressed Stop"
    asyncio.run(f.draw_equipment())
    assert "stopped" in stages[-1][2]
