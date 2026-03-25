# CLI Commands

The `vole` CLI is the primary interface for managing your OpenVole agent.

::: tip
Install globally with `npm install -g openvole` to use `vole` directly instead of `npx vole`.
:::

## Agent Commands

### `vole init`

Initialize a new OpenVole project. Creates `vole.config.json` and the `.openvole/` directory structure.

```bash
npx vole init
```

### `vole start`

Start the agent in interactive mode with a chat-style CLI. Loads all configured paws, channels, and the dashboard.

```bash
npx vole start
```

### `vole run`

Run a single task in headless mode — no dashboard, no channels. Useful for scripting and automation.

```bash
npx vole run "summarize my emails"
```

## Paw Management

### `vole paw add`

Install a Paw from npm and add it to your config.

```bash
npx vole paw add @openvole/paw-telegram
npx vole paw add @openvole/paw-browser
```

### `vole paw remove`

Remove an installed Paw.

```bash
npx vole paw remove @openvole/paw-telegram
```

### `vole paw list`

List all loaded Paws.

```bash
npx vole paw list
```

### `vole paw create`

Scaffold a new Paw project.

```bash
npx vole paw create my-custom-paw
```

## Skill Management

### `vole skill add`

Add a local skill.

```bash
npx vole skill add my-skill
```

### `vole skill remove`

Remove a skill.

```bash
npx vole skill remove my-skill
```

### `vole skill list`

List all loaded skills.

```bash
npx vole skill list
```

### `vole skill create`

Create a new local skill with a template SKILL.md.

```bash
npx vole skill create email-triage
```

## ClawHub

### `vole clawhub install`

Install a skill from [ClawHub](https://clawhub.ai).

```bash
npx vole clawhub install summarize
```

### `vole clawhub remove`

Remove an installed ClawHub skill.

```bash
npx vole clawhub remove summarize
```

### `vole clawhub search`

Search for skills on ClawHub.

```bash
npx vole clawhub search email
```

## Tool Commands

### `vole tool list`

List all registered tools (from manifests, no paw spawning).

```bash
npx vole tool list
```

Use `--live` to boot the full engine and discover MCP tools:

```bash
npx vole tool list --live
```

### `vole tool call`

Call a tool directly without going through the Brain. Useful for debugging.

```bash
npx vole tool call list_schedules
```

## Utility Commands

### `vole upgrade`

Upgrade OpenVole and all installed paws to their latest versions.

```bash
npx vole upgrade
```

### `vole --version`

Show the installed OpenVole version.

```bash
npx vole --version
```
