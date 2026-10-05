---
name: Coding Guidelines
description: Conventions, standards, and other guidelines for coding agents.
---

# Coding Guidelines

Always adhere to these guidelines and conventions when writing code.

## Development Approach

1. **Read first**: Always read existing code before modifying it
2. **Prefer performant code**: Consider the performance implications of different approaches
3. **Iterate in small steps**: Implement one feature at a time; test before proceeding
4. **Look for edge cases**: Consider possible edge cases and other points of failure
5. **Validate correctness**: Verify changes; run tests and sanity checks
6. **Document findings**: Keep `NOTES.md` updated with key decisions and important insights

## Code Conventions

- Prefer clear and readable code following modern design practices
- Include helpful comments for non-obvious logic but keep them concise
- Use meaningful variable and function names that clearly describe their purpose
- Use standard/common naming conventions and always maintain consistency
- Use tab instead of space for line indentation

## Code Standards

- The code should be easy to read, well organized, and well optimized
- The code should be modular and not full of unnecessary repetition
- Aim for simple and elegant solutions but always keep performance in mind
- Aim for portable and future-proof solutions, avoid deprecated systems
- Aim for accuracy, avoid easy shortcuts and prefer correct solutions

## Constraints

- DO NOT rewrite working code unless there is a clear correctness or performance reason
- DO NOT add features, refactor, or introduce abstractions beyond what the task requires
- DO NOT skip validation — always check that things work correctly before marking a task done
- DO NOT mask problems by treating the symptoms — fix the underlying issue if possible
- ALWAYS update `NOTES.md` with any key decisions, insights, or lessons learned
- When the work is an assigned task, update that task's notes when you start and when you finish
