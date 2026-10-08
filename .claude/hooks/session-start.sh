#!/bin/bash
# Installs dependencies so the backend, web and tablet suites can run in a
# Claude Code cloud session. Local machines already have their own setup.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Backend: venv at ./.venv, same place CLAUDE.md expects it.
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
.venv/bin/pip install -q --disable-pip-version-check -r requirements.txt

# Frontends: npm install (not ci) so the cached container state is reused;
# --no-save keeps the cloud npm from rewriting the committed lockfiles.
for dir in web tablet menu; do
  (cd "$dir" && npm install --no-save --no-audit --no-fund --loglevel=error)
done

# Make `python` / `pytest` resolve to the venv for the rest of the session.
echo "export PATH=\"$CLAUDE_PROJECT_DIR/.venv/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
