"""The language the agents write in, English or Indonesian, chosen on the screens for every project. English until someone picks Indonesian.

The documents stay as they are. What an agent quotes from them, and the names it takes from them (documents, work packages, BoQ lines and
regulations), stay in the documents' own words: code checks a quote against its page, and finds a work package's pages by its name.
"""

from __future__ import annotations

LANGUAGES = {"en": "English", "id": "Indonesian"}
DEFAULT = "en"
KEEP = "Keep as the documents have them, letter for letter: words you quote, which code checks against the page, and the names of documents, work packages, BoQ lines and regulations."
RULES = {
    "en": "Language: write every word of your own in English, though the documents are in Indonesian: subjects, questions, notes, reasons, summaries, sections, tasks and procedures. "
          "Name a party by its role in English, with its Indonesian title after it where the reader needs that to find the person: the supervision consultant (Konsultan Pengawas), the commitment officer (PPK), the owner (Pengguna Jasa). " + KEEP,
    "id": "Language: write every word of your own in Indonesian (Bahasa Indonesia), as a site manager in Indonesia writes it: subjects, questions, notes, reasons, summaries, sections, tasks and procedures. " + KEEP +
          " Where these instructions ask for English words for a machine to read, such as nouns for a vision model, give those in English.",
}


def _file():
    from . import project as P  # here and not at the top: every agent's turn reads this, and regulations, which imports nothing, says things in it

    return P.SCENARIO_DB.parent / "language.txt"


def current() -> str:
    try:
        said = _file().read_text(encoding="utf-8").strip()
    except OSError:
        return DEFAULT
    return said if said in LANGUAGES else DEFAULT


def choose(code: str) -> str:
    if code not in LANGUAGES:
        raise ValueError(f"language must be one of: {', '.join(LANGUAGES)}")
    _file().write_text(code, encoding="utf-8")
    return code


def rule() -> str:
    """What every agent is told, at the end of its instructions."""
    return RULES[current()]


def say(english: str, indonesian: str) -> str:
    """Code's own words, in the language chosen."""
    return indonesian if current() == "id" else english
