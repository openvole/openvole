# Contributing to OpenVole

Thank you for your interest in contributing to OpenVole! This guide covers contributions to the **core framework** (`openvole`) and the **Paw SDK** (`@openvole/paw-sdk`).

For contributing Paws (plugins), see the [PawHub CONTRIBUTING.md](https://github.com/openvole/pawhub/blob/main/CONTRIBUTING.md).

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/<your-username>/openvole.git`
3. Add upstream remote: `git remote add upstream https://github.com/openvole/openvole.git`
4. Install dependencies: `pnpm install`
5. Build: `pnpm -r build`
6. Run tests: `pnpm -C src/core test`

Before starting work, sync your fork with upstream:

```bash
git fetch upstream
git checkout main
git merge upstream/main
```

## What to Work On

- **Good first issues**: Check [issues labeled `good first issue`](https://github.com/openvole/openvole/labels/good%20first%20issue) for beginner-friendly tasks
- **Bug fixes**: Open a PR directly with a clear description
- **New features or architecture changes**: Open a [GitHub Discussion](https://github.com/openvole/openvole/discussions) first — let's align on the approach before writing code

## Architecture Principles

OpenVole follows a **microkernel architecture** — the core provides mechanism, not policy:

- The core is **LLM-ignorant** — it has no LLM dependencies
- **Tools** are the first-class runtime abstraction
- **Paws** are tool providers (subprocess-isolated or in-process)
- **Skills** are behavioral recipes that consume tools by name
- Before proposing a core change, consider whether it could be a **Paw** instead
- Core changes are welcome when they improve the engine, CLI, sandbox, scheduling, or other framework-level concerns

## Development Standards

### Code
- TypeScript strict mode, ESM only
- Biome for formatting and linting
- No unnecessary abstractions — keep it simple
- No backwards-compatibility hacks — if something is unused, remove it

### Commits
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `docs:`, `test:`
- Keep commits focused — one logical change per commit
- Write clear commit messages that explain **why**, not just what

### Tests
- All core changes must pass existing tests: `pnpm -C src/core test`
- New features should include tests
- Test files go in `src/core/tests/`
- We use Vitest

### Pull Requests
- Keep PRs focused — one feature or fix per PR
- Describe **what** changed and **why**
- Include before/after screenshots for CLI or dashboard changes
- Make sure CI passes before requesting review
- Don't include unrelated changes (formatting, refactoring, etc.)

## Project Structure

```
src/
  core/           → openvole (agent loop, registries, CLI, scheduler, vault)
    src/
      cli.ts      — CLI commands (start, run, init, paw/skill/tool management)
      index.ts    — Engine orchestrator
      core/       — Loop, scheduler, task queue, bus, rate limiter, vault
      paw/        — Paw registry, loader, sandbox, manifest
      skill/      — Skill registry, loader, resolver
      tool/       — Tool registry, core tools
      config/     — Config types and helpers
      context/    — Agent context types
      io/         — VoleIO (TTY, pluggable)
    tests/        — Vitest test files
  paw-sdk/        → @openvole/paw-sdk (definePaw, transports, types)
```

## Skills

Skills are SKILL.md files — behavioral recipes with no code. They are not developed in this repository. To share a skill:

- **ClawHub**: Submit to [ClawHub](https://clawhub.ai) for community discovery
- **Local**: Place in `.openvole/skills/<name>/SKILL.md` for personal use

See the [Skill documentation](/skills) for the SKILL.md format.

## What NOT to Submit

- Refactor-only PRs without functional changes
- New core tools without a design discussion
- Changes that add LLM dependencies to core
- Features that should be a Paw or Skill

## Security

If you discover a security vulnerability, please report it responsibly:
- Email: contact@limnr.com
- Do **not** open a public issue for security vulnerabilities
- Include: severity assessment, reproduction steps, and suggested fix if possible

## Maintainers

OpenVole is maintained by the [OpenVole team](https://github.com/openvole). Maintainers review PRs, handle versioning, and publish to npm.

If you're interested in becoming a maintainer, demonstrate consistent contributions and reach out via GitHub Discussions.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](https://github.com/openvole/openvole/blob/main/LICENSE).
