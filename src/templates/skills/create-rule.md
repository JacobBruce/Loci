---
name: Create Rule
description: Create a Loci rule for standing prompt guidance. Use when adding coding standards, conventions, or always-on instructions, or when the user asks how rules work.
---

# Creating Loci rules

A rule is a markdown file that the harness appends to the system prompt when enabled.

## Locations

| Scope | Path | Who writes |
|---|---|---|
| This house | `rules/<name>.md` | You, with `write_file` / `edit_file`. You may not delete it. |
| All houses | `loci-rules/<name>.md` | Read only. The user adds these. Tools cannot write `loci-rules/`. |

`loci-rules/` is an alias. Do not use a home-directory path. A house file and a global file can share a filename.

A file you create stays **off** until the user turns it on. Do not expect it to take effect just because you wrote it.

## Gather requirements

1. **Purpose** — what the rule should enforce or teach
2. **Filename** — short kebab-case `.md` (e.g. `python-style.md`)

Infer from the conversation when possible. If scope is unclear, ask the user.

## File format

```markdown
---
name: Rule name
description: What the rule is for.
---

# Rule title

Actionable instructions…
```

YAML frontmatter is stripped at load time. Only the body enters the prompt. `read_file` returns the file as stored, frontmatter included.

Rules are a single flat `*.md` file. Do not create `rules/<name>/…`.

## Authoring principles

- One concern per file — prefer several small rules over one large blob
- Actionable and concrete — write like internal docs

## Enable new rules

After writing a rule tell the user how to enable it in Loci:

1. Click on the Rule Book (in the Living room)
2. Click the toggle next to a rule name to enable the rule
