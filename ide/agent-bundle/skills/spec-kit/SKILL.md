---
name: spec-kit
description: Spec-driven development. Use when a request is a feature or a change big enough that jumping straight to code would guess at requirements - write the specification first, then a technical plan, then a task breakdown, then implement against them. Also use when asked to clarify vague requirements, to produce a spec, plan, task list, project constitution or a review checklist, or when the user names spec-driven development or spec-kit.
license: MIT
---

# Spec-Driven Development

GitHub's Spec Kit workflow, bundled so it works with no install. The value is the
order: specify what and why before how, and let each stage be reviewable on its
own rather than discovering the requirements while writing the code.

## The workflow

Each stage has a prompt in `commands/` and, where it produces a document, a
template in `templates/`. Read the command file for the stage you are in and
follow it.

| Stage | Command file | Produces |
|---|---|---|
| Establish project principles | `commands/constitution.md` | `constitution-template.md` |
| Define requirements | `commands/specify.md` | `spec-template.md` |
| Resolve ambiguity in a spec | `commands/clarify.md` | edits to the spec |
| Technical plan | `commands/plan.md` | `plan-template.md` |
| Task breakdown | `commands/tasks.md` | `tasks-template.md` |
| Review checklist | `commands/checklist.md` | `checklist-template.md` |
| Cross-check spec/plan/tasks agree | `commands/analyze.md` | findings |
| Build it | `commands/implement.md` | the change |

`commands/converge.md` and `commands/taskstoissues.md` cover reconciling
divergent work and turning a task list into issues.

## How to use it here

- **Not every task needs this.** A one-line fix does not. Reach for it when the
  request is a feature, a rewrite, or anything where the requirements are not
  yet pinned down.
- **Put the stages on the board.** PulsarIDE has a project tracker: `add_item`
  each stage as you plan it, move it to `wip` when you start and `works`/`done`
  as it lands, and use `add_milestone` for the phases. The spec, plan and tasks
  are exactly the kind of multi-step work the Roadmap exists for, so a reader
  can see where the feature is without reading the documents.
- **Write the documents into the project**, conventionally under `specs/`, so
  they are reviewable and survive the session. Say where you put them.
- **A stage is not done because it was written.** The spec is done when it is
  unambiguous, the plan when it names real files and real interfaces, the tasks
  when each is independently checkable.
