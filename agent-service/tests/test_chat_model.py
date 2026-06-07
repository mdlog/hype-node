"""Unit tests for _chat_model_for — the single source of truth mapping the
active LLM provider to the model id reported back in ChatUsage.model, so the
Next.js billing meter prices the model the agent actually ran.

Run with:
    cd agent-service && .venv/bin/python -m pytest tests/test_chat_model.py -q
"""

from src.chat_agent import _chat_model_for


def test_openai_provider_reports_configured_openai_model(monkeypatch):
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4o")
    assert _chat_model_for("openai") == "gpt-4o"


def test_openai_provider_defaults_to_gpt_4o(monkeypatch):
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    assert _chat_model_for("openai") == "gpt-4o"


def test_anthropic_provider_reports_configured_model(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
    assert _chat_model_for("anthropic") == "claude-sonnet-4-6"


def test_anthropic_provider_defaults_to_sonnet(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_MODEL", raising=False)
    assert _chat_model_for("anthropic") == "claude-sonnet-4-5"
