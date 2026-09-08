---
name: executing-plans
description: Use when you have an implementation plan to execute in a separate session with review checkpoints
---

# Executing Plans

## Overview

Load plan, review critically, execute tasks in batches, report for review between batches.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

**Note:** This workflow is much more effective with subagents (Claude Code, Codex CLI, Codex App, and Copilot CLI all qualify). If subagents are available, use subagent-driven-development instead of this skill.

**Where plans live:**
- Read tasks and constraints from the host agent's active built-in plan.
- Never require, create, save, or commit plan Markdown files unless the user explicitly asks for a file.
- If the host has no built-in plan capability, use plan content from chat (for example, after writing-plans or user-provided requirements).

## The Process

### Step 1: Load and Review Plan
1. Read the active built-in plan — or plan content from chat if no built-in plan exists
2. Note global constraints (Goal, Architecture, Tech Stack, Global Constraints)
3. Review critically - identify any questions or concerns about the plan
4. If concerns: Raise them with your human partner before starting
5. If no concerns: Create todos for the plan items and proceed

### Step 2: Execute Batch

**Default: first 3 tasks**

For each task in the batch:
1. Mark as in_progress
2. Follow each step exactly (plan has bite-sized steps)
3. Run verifications as specified
4. Mark as completed

### Step 3: Report

When batch complete:
- Show what was implemented
- Show verification output
- Say: "Ready for feedback."
- Wait for feedback before continuing

### Step 4: Continue

Based on feedback:
- Apply changes if needed
- Execute next batch
- Repeat until all tasks complete

### Step 5: Complete Development

After all tasks complete and verified:
- Summarize what was implemented across all batches
- Show final verification status
- Hand control back to the user

## When to Stop and Ask for Help

**STOP executing immediately when:**
- Hit a blocker (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly

**Ask for clarification rather than guessing.**

## When to Revisit Earlier Steps

**Return to Review (Step 1) when:**
- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking

**Don't force through blockers** - stop and ask.

## Remember
- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- Reference skills when plan says to
- Report after each batch and wait for feedback
- Stop when blocked, don't guess
- Never start implementation on main/master branch without explicit user consent
