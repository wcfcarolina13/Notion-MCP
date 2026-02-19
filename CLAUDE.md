# Ralph Methodology for Claude Code

This project uses the **Ralph autonomous development methodology**. Ralph treats LLM context like memory - it cannot be freed, only rotated. State persists in files and git, not in conversation context.

## Core Philosophy

> "That's the beauty of Ralph - the technique is deterministically bad in an undeterministic world."

Ralph will make mistakes. Each mistake is an opportunity to add a "sign" (guardrail) that prevents that mistake in the future.

## Before Every Action

**ALWAYS read these files first:**
1. `RALPH_TASK.md` - Your current task and completion criteria
2. `.ralph/guardrails.md` - Lessons from past failures (FOLLOW THESE)
3. `.ralph/progress.md` - What's been accomplished so far
4. `.ralph/errors.log` - Recent failures to avoid

## Working Protocol

### Task Execution
1. Find the next unchecked criterion in RALPH_TASK.md (look for `[ ]`)
2. Focus on ONE criterion at a time - complete it fully before moving on
3. Run tests after changes (check RALPH_TASK.md for test_command)
4. Mark completed: change `[ ]` to `[x]` in RALPH_TASK.md
5. Update `.ralph/progress.md` with what you accomplished
6. Commit your changes with descriptive message

### Git Protocol (Critical)
Ralph's strength is state-in-git, not LLM memory. Commit early and often:
- After completing each criterion: `git add -A && git commit -m "ralph: description"`
- Before any risky refactor: commit current state as checkpoint
- Your commits ARE your memory across sessions

### When Complete
When ALL criteria show `[x]`, say: **"RALPH COMPLETE - all criteria satisfied"**

### When Stuck
If stuck 3+ times on the same issue, say: **"RALPH GUTTER - need fresh context"**
This signals that context rotation may help.

## Learning from Failures

When something fails:
1. Log it to `.ralph/errors.log`
2. Figure out the root cause
3. Add a Sign to `.ralph/guardrails.md`:

```markdown
### Sign: [Descriptive Name]
- **Trigger**: When this situation occurs
- **Instruction**: What to do instead
- **Added after**: Iteration N - what happened
```

## State Files

```
.ralph/
├── guardrails.md    # Lessons learned ("signs") - READ BEFORE ACTING
├── progress.md      # What's been accomplished
├── errors.log       # Failure history
├── activity.log     # Session activity
└── .iteration       # Current iteration counter
```

## Key Principles

1. **Context is memory** - Everything loaded stays loaded
2. **You cannot free() context** - Only starting fresh clears it
3. **One task per focus** - Mixed concerns lead to failure
4. **Don't redline** - Complete work before context fills
5. **Trust the files** - Progress is in files and git, not your memory

## Scripts

- `./scripts/init-ralph.sh` - Initialize/reset state
- `./scripts/ralph-once.sh` - Run single iteration
- `./scripts/ralph-loop.sh` - Run autonomous loop
