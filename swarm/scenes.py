"""What each site photo shows. Image models do not reliably draw an exact count, so every accepted photo was counted by eye and
these counts say what the image really shows; assets/photos_manifest.json records the model that made it. A view is treated as
representative of the whole BoQ item."""

from __future__ import annotations

from dataclasses import dataclass, replace

CONCEALED, BLOCKED = "concealed", "blocked"


@dataclass(frozen=True)
class Scene:
    setting: str
    position: str = ""  # what is counted, in the plural
    total: int = 0
    installed: int = 0
    done: str = ""  # what a complete position looks like
    todo: str = ""  # what an incomplete position looks like
    layout: str = ""
    kind: str = "count"  # count | concealed | blocked
    rows: int = 1
    ask: str = ""  # the question for a view where the work cannot be counted, phrased like any other

    @property
    def what_to_count(self) -> str:
        if self.kind != "count":
            return self.ask
        return f"Count the {self.position}. Complete: {self.done}. Not complete: {self.todo or 'not applicable, all look complete'}."


def _columns(level: str, installed: int) -> Scene:
    return Scene(f"the open top floor of the concrete frame at {level}, seen from the side at a distance, with a concrete slab underfoot", "column positions", 5, installed,
                 "a finished, cast grey concrete column about 3 m tall", "only a bare steel rebar cage, with no concrete and no formwork",
                 "one straight row of five, side by side and evenly spaced, seen straight on, not in perspective")


def _beams(level: str, total: int, installed: int) -> Scene:
    return Scene(f"the side of the concrete frame at {level}, seen from outside and straight on", "spans between columns", total, installed,
                 "a cast grey concrete beam joining the tops of the two columns", "nothing at the top, only open sky between the two columns",
                 f"one straight row of {total} spans side by side")


def _windows(level: str, installed: int) -> Scene:
    return Scene(f"an exterior plastered wall of {level}, seen from outside and straight on", "window openings", 8, installed,
                 "an aluminium frame with glass fitted", "an empty dark opening with no frame and no glass", "one straight, evenly spaced row of eight")


SCENES: dict[str, dict[str, Scene]] = {
    "ST-01": {"A": Scene("the finished concrete frame of Level 2, seen from the side at a distance, with a slab above and below", "column positions", 6, 6,
                         "a finished, cast grey concrete column reaching the slab above", "", "one straight row of six, side by side and evenly spaced, seen straight on")},
    "ST-02": {"A": _beams("Level 2", 6, 6)},
    "ST-03": {"A": replace(_columns("Level 3", 2), total=6), "B": _columns("Level 3", 3)},
    "ST-04": {"A": _beams("Level 3", 4, 2)},
    "ST-05": {"A": Scene("Level 3 seen from above, from a higher scaffold, looking down at the floor", "square floor bays separated by beams", 4, 2,
                         "smooth poured grey concrete", "exposed steel rebar mesh over plywood formwork, with no concrete", "a neat two by two grid", rows=2)},
    "ST-06": {"A": Scene("a smooth, finished, poured concrete floor slab on Level 3. No reinforcing steel can be seen anywhere", kind=CONCEALED, ask="Count the installed slab rebar and the rebar still to be placed.")},
    "ST-07": {"A": Scene("a large, smooth, finished concrete slab on Level 3, seen from floor level. The thickness and volume of the concrete cannot be judged", kind=CONCEALED, ask="Work out how much of the concrete volume has been placed.")},
    "AR-01": {"A": Scene("the concrete frame of Level 1, seen straight on", "bays between columns", 5, 5, "filled with a red brick wall up to the beam", "", "one straight row of five")},
    "AR-02": {"A": Scene("the concrete frame of Level 2, seen straight on", "bays between columns", 6, 4, "filled with a red brick wall up to the beam",
                         "completely empty, with nothing between the columns", "one straight row of six")},
    "AR-03": {"A": Scene("a long brick wall on Level 1, divided by concrete columns, seen straight on", "wall bays between columns", 5, 2,
                         "covered with smooth grey cement plaster", "bare red brick with no plaster", "one straight row of five")},
    "AR-04": {"A": _windows("Level 1", 6)},
    "AR-05": {"A": _windows("Level 2", 2)},
    "AR-06": {"A": Scene("a long plastered corridor wall on Level 1", "door openings", 6, 6, "a timber door fitted and closed", "", "one evenly spaced row of six")},
    "AR-07": {"A": Scene("the east elevation of the building, seen from outside and straight on", "large facade panel positions", 5, 2,
                         "a flat grey aluminium panel fixed in place", "bare concrete with an empty metal support frame", "one straight row of five, side by side")},
    "AR-09": {"A": Scene("the floor of a narrow empty room on Level 1, photographed straight down from a high ladder, with a plain wall along the left edge and a plain wall along the right edge of the photo. Thin dark joint lines divide the floor into equal square-ended strips between the two walls", "floor strips", 5, 2,
                         "completely laid with light ceramic floor tiles", "bare grey cement screed with no tiles", "five equal strips side by side, from left to right")},
    "AR-10": {"A": Scene("Level 2 seen through a dense green scaffold safety net that hangs across almost the whole view, so that the interior partition walls behind it cannot be made out or counted", kind=BLOCKED, ask="Count the partition bays. Complete: a finished partition wall. Not complete: an open bay with no wall.")},
    "AR-11": {"A": Scene("the long open edge of a Level 2 balcony walkway, seen straight on", "edge sections between posts", 6, 4,
                         "a steel railing fixed in place", "an open edge with no railing at all", "one straight row of six, seen straight on")},
    "AR-12": {"A": _windows("Level 3", 2)},
    "ME-01": {"A": Scene("a finished ceiling on Level 1, looking up", "light positions", 6, 6, "a rectangular LED panel light fitted", "", "a neat grid of two rows of three", rows=2)},
    "ME-02": {"A": Scene("a long plastered interior wall on Level 2, seen straight on", "socket positions at waist height", 7, 2,
                         "a white socket faceplate fitted", "an empty recessed box with loose wires", "one straight, evenly spaced row of seven")},
    "ME-03": {"A": Scene("a finished, plastered and painted interior wall on Level 2. No conduit or pipe can be seen anywhere", kind=CONCEALED, ask="Count the conduit runs installed and those still to be installed.")},
    "ME-04": {"A": Scene("a long plastered interior wall on Level 1, seen straight on", "air conditioner positions high on the wall", 6, 3,
                         "a white wall-mounted indoor unit fitted", "only an empty metal mounting plate on the bare wall", "one straight, evenly spaced row of six")},
    "ME-05": {"A": Scene("a ceiling on Level 2 with a red sprinkler pipe running along it, looking up", "pipe drops", 4, 3,
                         "a brass sprinkler head fitted", "closed with a plain red plastic cap", "one straight, evenly spaced row of four along the pipe")},
    "ME-06": {"A": Scene("the wall of a plant room, seen straight on", "marked panel positions on the wall", 6, 3, "a grey electrical distribution cabinet fixed in place",
                         "an empty rectangle marked on the wall, with cable stubs below it", "one straight, evenly spaced row of six")},
    "PL-01": {"A": Scene("a finished flat roof covered with cement screed and protective tiles. The waterproofing membrane underneath cannot be seen", kind=CONCEALED, ask="Work out how much of the waterproofing membrane has been laid.")},
    "PL-02": {"A": Scene("a long washroom on Level 1, looking along a row of open cubicles", "toilet positions", 6, 6, "a white ceramic toilet fitted", "", "one straight row of six")},
}


def prompt(scene: Scene) -> str:
    style = ("Realistic documentary photo taken on a phone by a site engineer at a mid-rise building construction site in Indonesia, in overcast daylight. "
             "No people, no vehicles, no logos, no signs and no readable text. ")
    if scene.kind != "count":
        return f"{style}The photo shows {scene.setting}."
    missing = scene.total - scene.installed
    parts = [f"{style}The photo shows {scene.setting}.",
             f"Exactly {scene.total} {scene.position} are visible, arranged as {scene.layout}, all fully inside the frame, none hidden, cropped or overlapping.",
             f"Exactly {scene.installed} of the {scene.total} have {scene.done}." if scene.installed else ""]
    if missing:
        parts.append(f"The other {missing} have {scene.todo}. The complete ones come first, starting from the left.")
    return " ".join(p for p in parts if p)
