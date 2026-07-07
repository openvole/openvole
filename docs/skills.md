# Skills

**Skills are behavioral recipes.** A Skill is a folder with a `SKILL.md` file — no code, no build step. They tell the Brain how to approach a task by providing structured instructions.

## SKILL.md Format

```markdown
---
name: summarize
description: "Summarize text, articles, or documents"
---
When asked to summarize content:
1. Identify the key points
2. Condense into 3-5 bullet points
...
```

The frontmatter defines metadata (name, description, required tools). The body contains the instructions the Brain follows.

## Progressive Loading

Skills are loaded on demand, not all at once. The Brain sees a compact list of available skills with descriptions. When a skill matches the current task, the Brain calls `skill_read` to load the full instructions.

This keeps the context window lean — only relevant skills are loaded.

### Skill Tools

| Tool | Purpose |
|------|---------|
| `skill_read` | Load full skill instructions |
| `skill_read_reference` | Access skill reference files |
| `skill_list_files` | List files in a skill directory |
| `skill_run_script` | Run a script bundled in the skill, confined to its directory |

## Bundled Scripts

A skill can ship runnable scripts (`.js`, `.py`, `.sh`) alongside its `SKILL.md`. The Brain runs them with `skill_run_script`, which is **confined to the skill's own directory** and runs with only the skill's declared environment (`metadata.openclaw.requires.env`) plus a PATH/HOME baseline — not the engine's full env. The interpreter is chosen by extension, and output is bounded (120s default, 600s cap). Scripts only run for a skill whose declared requirements (tools, bins, env) are met. This lets a skill do real work — transcode video, call a CLI — while the `SKILL.md` stays pure instructions.

## Installing Skills

### From VoleHub

[VoleHub](https://github.com/openvole/volehub) is OpenVole's own registry. Skills install with **every bundled file** (SKILL.md + scripts/references), each verified against a per-file SHA-256 in the registry's `INDEX.json`:

```bash
vole skill install resolve-autocut   # fetches all files, verifies hashes
vole skill hub                        # list installed VoleHub skills
vole skill uninstall resolve-autocut
```

Publish your own with `vole skill publish <dir>`, which prints the `files` manifest (with hashes) to add to `INDEX.json`.

### From ClawHub

[ClawHub](https://clawhub.ai) has 13,000+ community skills:

```bash
vole clawhub install summarize
vole clawhub search email
```

### Create Local Skills

```bash
vole skill create email-triage
```

This creates a new skill directory in `.openvole/skills/email-triage/` with a template `SKILL.md`.

### Manage Skills

```bash
vole skill list          # List loaded skills
vole skill add my-skill  # Add a local skill
vole skill remove my-skill
```

## OpenClaw Compatibility

OpenVole loads [OpenClaw](https://openclaw.ai) skills natively — same `SKILL.md` format, same `metadata.openclaw.requires` fields. Skills written for OpenClaw work on OpenVole and vice versa.

## Configuration

Add skills to your `vole.config.json`:

```json
{
  "skills": ["clawhub/summarize", "local/email-triage"]
}
```
