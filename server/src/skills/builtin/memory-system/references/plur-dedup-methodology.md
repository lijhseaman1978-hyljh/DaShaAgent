# PLUR Engram Dedup Methodology

> 2026-06-15 记忆系统优化期间发现并记录

## Problem

PLUR engrams accumulate duplicates over time — same knowledge stored in multiple forms.
In the memory overhaul session, 71 engrams contained ~25 redundant entries (35% waste).

## Dedup Process

### Step 1: List all engrams
```
plur_list(limit=100)
```
Returns all engrams with id, statement, domain, type, scope.

### Step 2: Identify duplicates by domain
Group engrams by domain:
- **rules**: Often duplicated across L1(memory), L2(PLUR), L3(EXAMPLE_MEMORY_TASK). Delete PLUR copies.
- **troubleshooting**: Same fix may be recorded multiple times (e.g., ENG-039 and ENG-069 both about OpenClaw upgrade).
- **cron**: Same task may appear twice (e.g., ENG-033 and ENG-056 both MSAT mail monitoring).
- **environment**: Same config may be split across multiple engrams.

### Step 3: Delete with reason
```
plur_forget(id='ENG-...', reason='与ENG-XXX重复')
```
Always include reason for traceability.

### Step 4: Verify
```
plur_list(limit=100)
plur_status()
```
Confirm count reduced and no critical knowledge lost.

## What NOT to delete

- **user** domain engrams — unique profile data
- **knowledge** domain engrams — vessel/spec data (not duplicated elsewhere)
- **project** domain engrams — progress tracking (not duplicated)
- engrams with high strength (>0.75) that reference unique file paths

## Post-dedup state

- Before: 71 engrams
- After: 46 engrams  
- Removed: 25 redundant entries
- Retained: 46 unique engrams across 8 domains
