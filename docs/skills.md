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

## Installing Skills

### From ClawHub

[ClawHub](https://clawhub.ai) has 13,000+ community skills:

```bash
npx vole clawhub install summarize
npx vole clawhub search email
```

### Create Local Skills

```bash
npx vole skill create email-triage
```

This creates a new skill directory in `.openvole/skills/email-triage/` with a template `SKILL.md`.

### Manage Skills

```bash
npx vole skill list          # List loaded skills
npx vole skill add my-skill  # Add a local skill
npx vole skill remove my-skill
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
