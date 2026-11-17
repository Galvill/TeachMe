# vidgen

Turns a short YAML script into a narrated explainer video. Work in progress; the design is
`docs/superpowers/specs/2026-11-17-vidgen-design.md` at the repo root.

```sh
uv sync
uv run vidgen --version
uv run vidgen validate path/to/script.yaml
uv run pytest -m "not endpoint"
```
