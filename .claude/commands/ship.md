---
description: Run the full speckit pipeline end-to-end (specify → clarify → plan → tasks → analyze → implement) with safety checkpoints
argument-hint: <feature description>
---

The user has invoked `/ship` to execute the full speckit workflow for this feature:

**Feature:** $ARGUMENTS

You are the orchestrator. Run the phases below in order via the `Skill` tool. Trust the git auto-commit hooks declared in `.specify/extensions.yml` to commit between phases — do not manually commit.

The user may not be at their Mac. They have Remote Control enabled and will answer `AskUserQuestion` prompts from their phone. Pause and wait when one fires — do not invent answers.

## Phases

1. **`speckit-specify`** — pass `$ARGUMENTS` as the feature description. Creates a new feature branch and `specs/<NNN>-<slug>/spec.md`.

2. **`speckit-clarify`** — interactive. Will ask up to 5 questions via `AskUserQuestion`. Wait for each answer. If any answer reveals the spec is materially wrong (not just underspecified), STOP and report — do not push through.

3. **`speckit-plan`** — generates `plan.md` and design artifacts.

4. **`speckit-tasks`** — generates `tasks.md`.

5. **`speckit-analyze`** — cross-artifact consistency check. Read the report carefully:
   - **CRITICAL or HIGH severity findings → STOP.** Summarize the findings and ask the user via `AskUserQuestion` whether to (a) fix and re-analyze, or (b) proceed to implement anyway.
   - **Only LOW/MEDIUM findings → proceed automatically.** Note them in your final summary.
   - **No findings → proceed silently.**

6. **`speckit-implement`** — long-running. Executes `tasks.md` with per-phase scoped gates per CLAUDE.md. The implement skill runs its own quality gates between phases and the full gate set at the end.

## After implement

Do NOT push or open a PR automatically — those are user-visible actions that need explicit confirmation. Instead, report:

- Feature branch name
- Number of tasks completed / total
- Any LOW/MEDIUM analyze findings that were carried through
- Suggested next step: "Run `/commit-commands:commit-push-pr` to open the PR."

## Rules

- One phase at a time. Verify the prior phase wrote its expected artifact before invoking the next skill.
- If a phase fails, STOP and report the failure — do not retry blindly or skip ahead.
- Don't re-read design docs the skills already inline. Don't re-run gates the skills already ran.
- Keep status updates terse. Each phase transition gets one sentence.
