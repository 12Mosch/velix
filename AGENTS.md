# Agent Instructions

## Vendored Repositories

This project vendors external repositories under `repos/`.

- Use vendored repositories as read-only reference material when working with related libraries.
- Prefer examples, tests, and implementation patterns from vendored source over generated guesses or stale web results.
- Do not edit files under `repos/` unless explicitly asked.
- Do not import from `repos/`; application code should continue importing from normal package dependencies.

When writing Effect code, read `repos/effect/LLMS.md` first and inspect `repos/effect/` for idiomatic usage, tests, module structure, and API design. Treat it as the source of truth for Effect patterns in this project.
