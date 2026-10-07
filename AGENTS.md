# Repository Guidelines

## Project Structure & Module Organization

This TypeScript ESM package bridges MCP clients to language servers over stdio. `src/index.ts` registers tools; `src/tools/` contains handlers; `src/services/` manages clients, documents, and diagnostics. Shared interfaces live in `src/types.ts`, Zod schemas in `src/schemas/`, configuration in `src/config.ts` and `src/config/`, and helpers in `src/utils/`.

Tests live in `tests/unit/` and `tests/acceptance/`, with mock servers in `tests/fixtures/`. Design documents live in `docs/plans/` and `specs/`. Build output goes to ignored `dist/`.

## Build, Test, and Development Commands

Use Node.js 20, matching CI, and npm:

- `npm ci`: install locked dependencies; the prepare hook also builds.
- `npm run build`: compile TypeScript into `dist/`.
- `npm run dev`: continuously compile changes; run `npm start` separately to launch the compiled stdio server.
- `npm test` / `npm run test:watch`: run unit tests once or interactively.
- `npm run typecheck`: check source types without emitting files.
- `npm run lint` / `npm run lint:fix`: check or fix ESLint issues in `src/`.

## Coding Style & Naming Conventions

Follow existing two-space indentation, single quotes, and semicolons. Use kebab-case filenames, camelCase functions and variables, PascalCase types/classes, and uppercase constants. Relative ESM imports require `.js` extensions, including imports from TypeScript sources. Use `import type` for types and prefix intentionally unused bindings with `_`. Respect strict TypeScript settings; omit optional properties rather than assigning `undefined`. ESLint is configured; no dedicated formatter is provided.

## Testing Guidelines

Use Vitest with descriptive `describe`/`it` cases in `*.test.ts` files. Add regression tests for changed behavior, using fixture servers for protocol interactions. Run one file with `npm test -- tests/unit/position.test.ts`. No numeric coverage threshold is configured.

Run `npm run test:acceptance` for BasedPyright workspace tests; these skip unless `BASEDPYRIGHT_COMMAND`, `PYTHON_WITH_PYDANTIC`, `PYTHON_WITHOUT_PYDANTIC`, and `LSP_ACCEPTANCE_ROOT` are set. See README for setup.

## Commit & Pull Request Guidelines

Follow history's conventional prefixes: `feat:`, `fix:`, `refactor(scope):`, `docs:`, or `chore:`. Describe the behavior changed, link relevant issues, and report validation in PRs. Run tests, typecheck, build, and lint before submission. Main-branch pushes automatically bump and publish versions; do not bump manually.

## Protocol & Security Invariants

Keep tool schemas, registrations, README, and SKILL.md synchronized. Preserve 1-indexed public positions, absolute paths, and workspace validation before writes. Spawn servers with `shell: false`; send logs to stderr so stdout remains available for MCP traffic.
