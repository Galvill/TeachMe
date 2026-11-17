.PHONY: setup test

# One-step install: uv, the Python env, the renderer, ffmpeg if needed, the vidgen command.
setup:
	bash ./setup.sh

# The CPU suites: renderer typecheck and vitest, then pytest without real endpoints.
test:
	cd renderer && npm run typecheck && npm test
	uv run pytest -m "not endpoint"
