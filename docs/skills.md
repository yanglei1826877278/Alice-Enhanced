# Agent Skills in Alice

Alice supports local [Agent Skills](https://agentskills.io/specification). A skill is a folder with a `SKILL.md` file containing YAML frontmatter and Markdown instructions. It may also contain `references/`, `scripts/`, and `assets/`.

```text
my-skill/
  SKILL.md
  references/
  scripts/
  assets/
```

```md
---
name: my-skill
description: Summarize a document when the user asks for a concise brief.
---

Read the document, identify its main findings, and produce a short brief.
```

The folder name and frontmatter `name` must match. Alice validates the required `name` and `description` fields against the Agent Skills format. It also reads optional `compatibility`, `license`, and `metadata` fields. To make a skill available only by explicit invocation, set `disable-model-invocation: true` in its frontmatter.

## Install and manage

Open **Settings → Custom tools → Agent Skills** and select **Import folder**, or place a skill folder directly in either location:

- User scope: `~/.agents/skills/<name>/SKILL.md`
- Alice scope in development: `<repo>/user-customization/skills/<name>/SKILL.md`
- Alice scope in a packaged app: `<userData>/user-customization/skills/<name>/SKILL.md`

Alice does not scan `~/.agents/skills` automatically. Select **Scan user skills** to update the set of user skills known to Alice. Newly added user skill folders stay hidden until the next manual scan.

Alice-installed skills take precedence over user skills with the same name. The settings panel supports refresh, enable/disable, and removal of Alice-installed skills. User skills stay in their original location and can be disabled in Alice without deleting them.

Start a message with `$my-skill` to invoke it directly. Otherwise, Alice can call `activate_skill` when a request matches an enabled skill's description. Alice sends only names and descriptions to the model initially; the full `SKILL.md` is loaded when activated. The model can then read referenced text files with `read_skill_file`.

Skill instructions do not grant new tool permissions. To run a bundled script, enable Alice's existing `execute_command` tool and approve the command through its normal permission flow. Scripts may need Node, Python, or another runtime installed on the user's machine. Alice does not run scripts automatically when a skill is activated.

Alice currently follows the portable Agent Skills format. Product-specific Claude Code features such as shell interpolation and subagent settings are not interpreted by Alice.
