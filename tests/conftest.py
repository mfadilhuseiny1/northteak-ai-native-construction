"""What every test shares."""

import pytest

from swarm import language


@pytest.fixture(autouse=True)
def english(tmp_path, monkeypatch):
    """Each test starts in English, the app's default, with its own choice of language: never the one this laptop's screens were last set to."""
    monkeypatch.setattr(language, "_file", lambda: tmp_path / "language.txt")
