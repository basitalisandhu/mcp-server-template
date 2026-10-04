# Contributing

Thanks for considering a contribution. The template is deliberately small: two implementations with the same four tools and the same controls, so a change to one usually needs the same change in the other.

## Set up

TypeScript (Node 20 or newer):

```bash
cd typescript
npm ci
npm run build
npm test
```

Python (3.11 or newer, with [uv](https://docs.astral.sh/uv/)):

```bash
cd python
uv sync
uv run ruff check . && uv run ruff format --check .
uv run pytest -q
```

Semgrep, as CI runs it (needs network access for the rule pack URL, or clone the pack and point `--config` at its `rules` directory):

```bash
pip install semgrep
semgrep --config https://raw.githubusercontent.com/basitalisandhu/agentic-semgrep-rules/main/agentic-semgrep-rules.yaml --metrics=off --error .
```

## Before you open a pull request

- Both implementations build and their tests pass offline after dependency install.
- Semgrep reports no findings. If a new control needs a new sanitiser name, add it to the rule pack rather than suppressing the finding.
- Any new tool has a fixed description, a strict input schema, read-only annotations unless it must write, and a test for the refused case as well as the allowed one.
- `SECURITY.md` is updated when a control is added, changed or removed, including the Semgrep mapping table.
- No secrets, tokens or key-shaped strings anywhere, including tests; gitleaks runs in CI.

## Style

- TypeScript: strict compiler settings, no `any`, ESM, zod schemas for every input.
- Python: `ruff` with the configured rule set, type hints, pydantic `Field` constraints for every input.
- Logs: JSON on stderr through the provided logger; never `console.log` or `print` in server code.
- Plain language in descriptions and docs: say what the tool does and what it refuses.

## Reporting security issues

See [SECURITY.md](SECURITY.md).
