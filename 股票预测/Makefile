.PHONY: dev backend frontend test build

dev:
	@(cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000) & backend_pid=$$!; \
	(cd frontend && npm run dev) & frontend_pid=$$!; \
	trap 'kill $$backend_pid $$frontend_pid 2>/dev/null || true' INT TERM EXIT; \
	wait

backend:
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

test:
	python -m unittest discover -s tests -q
	backend/.venv/bin/python -m pytest backend/tests -q
	cd frontend && npm test
	cd frontend && npm run typecheck

build:
	cd frontend && npm run build
