---
name: Create Skill
description: Create a Loci skill (flat .md or a folder with SKILL.md). Use when authoring a workflow the agent should read on demand, or when the user asks how skills work.
---

# Creating Loci skills

Skills teach the agent a specific workflow. Loci lists them in a catalog; read the skill file with `read_file` when the task needs it.

## Locations

| Scope | Path | Who writes |
|---|---|---|
| This house | `skills/…` | You, with `write_file` / `edit_file`. You may not delete it. |
| All houses | `loci-skills/…` | Read only. The user adds these. Tools cannot write `loci-skills/`. |

Paths in the catalog look like `skills/my-skill.md`, `skills/my-skill/SKILL.md`, or `loci-skills/my-skill.md`.

`loci-skills/` is an alias. Do not use a home-directory path. A house skill and a global skill can share a name.

A file you create stays **off** until the user turns it on in the Rule Book. Do not expect it to appear in the catalog just because you wrote it.

## Layout (pick one)

**Flat** — `skills/<name>.md`

**Folder** — when you need extra files:

```
skills/<name>/
  SKILL.md
  reference.md
```

Sibling files sit next to `SKILL.md`. Read a sibling the same way: `read_file` on `skills/<name>/reference.md` or `loci-skills/<name>/reference.md`.

## Gather requirements

1. Purpose / workflow
2. Flat vs folder (use a folder if you need reference files)
3. Trigger terms for the description
4. Any verbatim wording from the user (keep it exact)

Infer from context; ask only what is still unclear.

## Frontmatter

```markdown
---
name: Skill name
description: What it does and when to use it. Third person. Include the words that should trigger it.
---
```

The body is the steps to follow. Keep `SKILL.md` focused. Put longer reference in a sibling file and link it.

## Authoring principles

- Progressive disclosure: essentials in `SKILL.md`, depth in linked files
- Consistent terminology; no time-sensitive “before date X” guidance
- Prefer forward-slash paths in instructions

## Enable new skills

After writing a skill tell the user how to enable it in Loci:

1. Click on the Rule Book (in the Living room)
2. Click the toggle next to a skill name to enable the skill
