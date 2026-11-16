# odderjam

FastAPI backend (`backend/`) + React/Vite frontend (`frontend/`). Served at http://localhost:8000 via `./run.sh`.

## Running tests (read this before saying tests can't run)

Run everything from the repo root. Do not install anything; the tools are already present.

- **Python suite (the main gate):** `.venv/bin/pytest -q`
  Use the venv binary, not bare `pytest` or `python3` (system Python lacks the dependencies). Expect ~530 passing, 0 skipped, ~7s.
- **Frontend JS tests:** `cd frontend && node --test src/*.test.js` (~100 tests, <1s).
  Several pytest tests (`test_glossary.py`, `test_nav_groups.py`, `test_help.py`, ...) already shell out to `node --test` for their own file, so the pytest run covers them too.

### Environment facts

- `node` v22 is at `/usr/bin/node` and is on PATH. It is installed. If `node` seems missing, run `command -v node` and `ls /usr/bin/node` before reporting anything; do not conclude it is absent from a skipped test.
- **`npm` is NOT installed** (no `/usr/bin/npm`). `npm test` and `npm run build` fail with "command not found". That is expected, not a broken setup. Use `node --test` directly for tests. `frontend/node_modules` and `frontend/dist` are already present, so no install or build is needed to test.
- Tests that need node use `skipif(shutil.which("node") is None, ...)`. A skipped node test means PATH is wrong in your shell. Treat any skip as a failure to investigate, not a pass.

### If a test command fails

1. Re-run with the exact commands above from the correct directory (`.venv/bin/pytest` from root; `node --test` from `frontend/`).
2. Do not report "unable to run tests" or "node not installed" without pasting the actual command and its error output.
3. Do not try to install npm, node or packages. Ask the user if something is truly missing.

## Notes

- Do not touch `.venv.py312-bak`, `.odderjam.db` or the `.odds_*` cache files; they are local state (the venv backup and `frontend/node_modules` are gitignored).
- Rebuilding `frontend/dist` needs `npm`/`vite`, which this machine lacks via npm; `frontend/node_modules/.bin/vite build` works if a rebuild is genuinely required.
