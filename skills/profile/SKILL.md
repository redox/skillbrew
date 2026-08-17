---
name: profile
description: "Profile macOS servers, runtimes, and systems software using Instruments/xctrace. Investigate CPU wall time, syscall pressure, thread contention, allocation churn, and memory fragmentation. Record traces, analyze hotspots, compare profiles, detect leaks. Optional GPU/Metal tooling when the workload is GPU-bound."
---

# Systems Profiling Skill

Unix-style profiling for macOS servers, runtimes, databases, storage engines, networking stacks, and compilers. Composable tools that pipe together.

Default investigation path: **wall time → on-CPU hotspots → off-CPU / syscall / lock wait → allocation rate → heap fragmentation**.

## Quick Start

```bash
# CPU wall time and hotspots (Time Profiler — default)
xtrace ./my_server --serve                         # record + print CPU summary
xtrace --cpu ./my_server                           # explicit CPU template
xtrace ./my_server | trace-speedscope -            # → interactive analysis (best)

# Syscall pressure, thread contention, scheduling (System Trace)
trace-record.sh -t 'System Trace' -d 10 -- ./my_server --serve
# → open .trace in Instruments.app for syscall volume/latency, lock waits, thread states

# Memory: allocation churn, leaks, growth
trace-memory.py summary -- ./my_server --serve     # RSS, dirty/resident, MALLOC_* breakdown
trace-memory.py leaks -- ./my_server               # detect leaks with backtraces
trace-memory.py growth -d 30 -- ./my_server        # track RSS/region growth over time
xtrace -t Allocations ./my_server                  # Instruments trace + memory summary
xtrace -t Leaks ./my_server                        # Instruments trace + leak report

# Instruction-level or counter analysis (when Time Profiler is not enough)
trace-record.sh -t 'Processor Trace' -d 3 -- ./my_binary
trace-record.sh -t 'CPU Counters' -d 10 -- ./my_binary
# → open in Instruments.app for every call (Processor Trace) or IPC/cache misses (CPU Counters)

# Optional: GPU profiling — only when the workload is actually GPU-bound
xtrace --gpu ./my_metal_app                        # Metal System Trace + GPU summary
xtrace --gpu --shader-timeline ./my_shader_app     # shader hotspot tooling
xtrace -t 'Game Performance' ./my_metal_app        # broader Metal/game trace
MTL_CAPTURE_ENABLED=1 ./build/examples/metal_compute_demo \
  --capture-only /tmp/metal_compute_demo.gputrace --seconds 0.2
trace-gputrace.py info /tmp/metal_compute_demo.gputrace
```

## `.gputrace` mental model

- **`xctrace` / Instruments CLI → `.trace`**
- **`MTLCaptureManager` or Xcode Metal Debugger → `.gputrace`**

So when a user asks for a `.gputrace`, make sure the **host project has capture code inside it** (or direct them to the Xcode GUI workflow). The tools in this repo can inspect `.gputrace` bundles, but they cannot synthesize one from an arbitrary external process.

## Scripts

| Script | Purpose |
|---|---|
| **`xtrace`** | Record + summarize. Prefix any command. Supports CPU (`--cpu`), Metal templates, `--shader-timeline`, and custom `--instrument` sets. |
| `trace-record.sh` | Record with full control (attach, wait-for, system-wide, templates, custom instruments, shader timeline patching) |
| `trace-analyze.py` | CPU analysis: summary, timeline, calltree, collapsed, diff, info |
| **`trace-memory.py`** | **Memory analysis: summary, leaks, growth, regions, heap** |
| `trace-speedscope.sh` | Interactive visualization (speedscope web UI) |
| `trace-flamegraph.sh` | Generate SVG flamegraph file |
| `trace-diff-flamegraph.sh` | Differential red/blue SVG between two traces |
| **`trace-gpu.py`** | **GPU / Metal analysis: state residency, command buffers, encoders, shader inventory/timeline, latency, ownership, counters** |
| **`trace-gputrace.py`** | **Inspect `.gputrace` bundles captured via `MTLCaptureManager`: metadata, resources, labels, shader names, buffer decoding, HTML reports. It inspects existing bundles; it does not create them.** |
| **`trace-shader.py`** | **Shader-profiler analysis: info, hotspots, callsites, collapsed stacks, SVG flamegraphs** |
| `trace-shader-flamegraph.sh` | Generate static SVG shader flamegraphs from shader-profiler rows |
| `trace-shader-speedscope.sh` | Open shader collapsed stacks in speedscope for interactive inspection |
| `trace-template.py` | Patch GPU templates so Shader Timeline is enabled from the CLI |
| `trace-check.sh` | Verify environment |
| `sample-quick.sh` | Lightweight profiling via macOS `sample` |

## Prerequisites

```bash
./install.sh    # installs to PATH, registers skills, prompts for optional tools
```

**Required:** Xcode or Command Line Tools, Python 3.8+
**Recommended:** speedscope (`npm install -g speedscope`), inferno (`cargo install inferno`)

**Debug symbols per toolchain:**

| Toolchain | Flag |
|---|---|
| C/C++ | `-g -O2` or `-gline-tables-only -O2` |
| Swift | `swift build -c release -Xswiftc -g` |
| Rust | `CARGO_PROFILE_RELEASE_DEBUG=true cargo build --release` |
| Node.js | V8 builtins automatic; JS needs `--perf-basic-prof` |
| Xcode | Debug has symbols; Release needs dSYM in build settings |
| CMake | `-DCMAKE_BUILD_TYPE=RelWithDebInfo` |

## CPU Profiling

### Dev Loop

```bash
# 1. Profile
BASELINE=$(xtrace -d 10 ./build/my_server --benchmark)

# 2. Visualize interactively
trace-speedscope.sh "$BASELINE"

# 3. Save baseline for comparison
trace-analyze.py summary "$BASELINE" --json > /tmp/before.json

# 4. Fix the hotspot, rebuild, re-profile
cmake --build .
AFTER=$(xtrace -d 10 ./build/my_server --benchmark)
trace-analyze.py summary "$AFTER" --json > /tmp/after.json

# 5. Compare
trace-analyze.py diff /tmp/before.json /tmp/after.json
```

### LLM Pattern

```bash
TRACE=$(xtrace -d 10 --no-summary ./build/my_server)
trace-analyze.py summary "$TRACE" --json --top 20 > profile.json
trace-analyze.py calltree "$TRACE" --min-pct 3.0
```

### Recording

```bash
trace-record.sh -d 10 -p <PID>                    # attach by PID
trace-record.sh -d 10 -n MyServer                 # attach by name
trace-record.sh --wait-for MyServer -d 10         # wait for spawn
trace-record.sh -d 10 -a                           # system-wide
trace-record.sh -t 'System Trace' -d 10 -- ./app  # syscalls, locks, scheduling
trace-record.sh -t 'Processor Trace' -d 3 -- ./app
trace-record.sh -t 'CPU Counters' -d 10 -- ./app
```

### Analysis Subcommands

All support `--process`, `--thread`, `--time-range`, and `-` for stdin.

```bash
trace-analyze.py summary <trace> [--top N] [--by self|total] [--json]
trace-analyze.py timeline <trace> [--window SIZE] [--adaptive] [--json]
trace-analyze.py calltree <trace> [--depth N] [--min-pct PCT]
trace-analyze.py collapsed <trace> [--with-module]
trace-analyze.py info <trace> [--json]              # show trace metadata & contents
trace-analyze.py diff <before.json> <after.json> [--threshold PCT]
```

**Wall time vs on-CPU time:** `trace-analyze.py timeline` buckets samples across the trace duration — compare bucket counts to wall-clock duration to spot idle or off-CPU gaps. Use `--time-range` on `summary` / `calltree` to zoom into a slow window.

### Visualization

```bash
xtrace ./app | trace-speedscope -                    # interactive (best)
trace-flamegraph.sh recording.trace -o profile.svg   # SVG file
trace-diff-flamegraph.sh before.trace after.trace -o diff.svg
```

## System Trace & Contention

Use **System Trace** when Time Profiler shows low CPU utilization but wall time is high — typical of syscall-heavy I/O, lock contention, or thread scheduling delays.

```bash
# Record
trace-record.sh -t 'System Trace' -d 10 -- ./my_server --serve
trace-record.sh -t 'System Trace' -d 10 -p <PID>   # attach to running server

# Combine with CPU summary from the same run (if Metal/CPU rows exist)
trace-analyze.py summary recording.trace --top 20
trace-analyze.py info recording.trace
```

**Interpret in Instruments.app** (System Trace has microsecond resolution not exposed by CLI analyzers):
- **Syscall volume and latency** — `read`/`write`/`poll`/`kevent`/`mach_msg` storms, slow `open`/`stat`
- **Thread states** — running vs runnable vs blocked; long blocked intervals on worker threads
- **Lock contention** — mutex/semaphore wait chains, priority inversion
- **Scheduling** — thread preemption, core migration, run-queue delays

For instruction-level or counter detail, record **Processor Trace** or **CPU Counters** and open in Instruments.app.

## Memory Analysis

### Quick Memory Check

```bash
# Overview of memory usage (RSS, dirty, resident, MALLOC_* regions)
trace-memory.py summary -- ./my_server --serve

# Check for leaks (with allocation backtraces)
trace-memory.py leaks -- ./my_server

# Analyze a running process
trace-memory.py summary -p <PID>
trace-memory.py leaks -p <PID>
```

### Track Memory Growth

```bash
# Watch memory over 30 seconds with 2s snapshots
trace-memory.py growth -d 30 --interval 2 -- ./my_server --serve

# JSON for programmatic analysis
trace-memory.py growth -d 30 --json -- ./my_server > memory_growth.json
```

### Detailed Analysis

```bash
# All VM regions with sizes — spot fragmentation, large mappings
trace-memory.py regions -p <PID>

# Heap allocations by class/type — allocation count and churn
trace-memory.py heap -p <PID>

# Combine with Instruments recording
xtrace -t Allocations -- ./my_server    # records trace + shows memory summary
xtrace -t Leaks -- ./my_server           # records trace + shows leak report
```

### Memory + Instruments Workflow

```bash
# 1. Quick CLI check
trace-memory.py leaks -- ./my_server
# → Found 3 leaks!

# 2. Record Instruments trace for deep analysis
trace-record.sh -t Allocations -d 30 -- ./my_server
# → Open .trace in Instruments.app for allocation timeline, call trees

# 3. Track memory over time
trace-memory.py growth -d 60 --json -- ./my_server > growth.json
# → Identify which regions are growing (MALLOC_*, MALLOC_LARGE, dirty vs resident)

# 4. Inspect trace metadata
trace-analyze.py info recording.trace
```

### LLM Pattern for Memory

```bash
# Quick leak check
trace-memory.py leaks --json -- ./my_server > leaks.json

# Memory overview
trace-memory.py summary --json -p <PID> > memory.json

# Growth tracking
trace-memory.py growth -d 20 --json -- ./my_server > growth.json
```

## Templates

| Template | When | Tool | Resolution |
|---|---|---|---|
| **Time Profiler** | General CPU profiling — **start here** | trace-analyze.py | 1ms sampling |
| **System Trace** | Syscall pressure, lock/thread contention, scheduling, off-CPU wait | Instruments.app | Microsecond |
| **Processor Trace** | Every function call, instruction-level hotspots | trace-analyze.py + Instruments.app | Every branch |
| **CPU Counters** | IPC, cache misses, branch mispredictions | Instruments.app | Per-event |
| **Allocations** | Allocation rate, object lifetimes, heap churn | **trace-memory.py** | Per-allocation |
| **Leaks** | Memory leaks, allocation backtraces | **trace-memory.py** | Per-allocation |
| **Metal System Trace** | GPU-bound workloads: utilization, command-buffer cadence, CPU/GPU correlation | **trace-gpu.py** + trace-analyze.py | Event intervals |
| **Metal System Trace + Shader Timeline** | GPU-bound shader hotspots / callsites / shader flamegraphs | **trace-shader.py** + `trace-shader-flamegraph.sh` + `trace-shader-speedscope.sh` | Event intervals + shader-profiler rows |
| **Game Performance** | Broader Metal/game traces: GPU state, shader inventory, driver activity, counters metadata | **trace-gpu.py** | Mixed |
| **Game Performance Overview** | High-level graphics/Metal overview metrics when available | **trace-gpu.py** | Metric intervals |
| Game Memory | Game memory budgets | trace-memory.py | Per-allocation |

## Interpreting Results

### CPU & Wall Time Patterns

| Pattern | Meaning | Action |
|---|---|---|
| High self time | Function body is on-CPU bottleneck | Optimize algorithm, reduce work |
| High inclusive, low self | Calls something expensive | Look at callees |
| `malloc`/`free` heavy | Allocation churn on hot path | Pool, arena, reduce allocations |
| Low CPU % but high wall time | Off-CPU wait: I/O, locks, scheduling | Record System Trace; check blocked threads |
| Timeline spike then flat | One-time startup or GC pause | Use `--time-range` to isolate; compare phases |
| `read`/`write`/`poll` in calltree | Syscall-bound I/O | Batch I/O, async, reduce copies |

### Contention & Syscall Patterns (System Trace)

| Pattern | Meaning | Action |
|---|---|---|
| Threads blocked on mutex/semaphore | Lock contention | Shorter critical sections, finer locking, lock-free structures |
| Runnable but not running | Scheduler pressure / too many threads | Reduce thread count, pin workers, tune pool size |
| High syscall count, low bytes moved | Syscall overhead dominates | Buffer, batch, use `sendmsg`/`readv`, memory-map files |
| `kevent`/`poll` wake storms | Event-loop churn | Coalesce events, increase batch size |

### Memory Patterns

| Pattern | Meaning | Action |
|---|---|---|
| Growing RSS over time | Memory leak or unbounded cache | Run `leaks`, check growth regions |
| High dirty, low resident | Swapping / memory pressure | Reduce working set, tune allocator |
| MALLOC_* / MALLOC_LARGE growing | Heap churn or large allocations | Check `heap`, reduce per-request allocations |
| Many small regions in `regions` | Fragmentation or allocator pressure | Pool objects, use arenas, tune `malloc` zone |
| Many leaks from one stack | Systematic leak pattern | Fix the allocation/release pair |
| Large IOKit/IOAccelerator | GPU memory (Metal/MLX) | Check GPU buffer lifecycle (GPU-bound workloads only) |

## Off-CPU / I/O-Bound Workloads

When wall time is high but Time Profiler samples are sparse, the process is likely waiting on I/O, locks, or the scheduler — not burning CPU.

```bash
# CPU mode — xtrace auto-falls back to sample if Time Profiler rows are empty
xtrace ./build/io_server --benchmark

# System Trace for syscall/contention detail (open in Instruments.app)
trace-record.sh -t 'System Trace' -d 10 -- ./build/io_server --benchmark

# Direct sample usage when xctrace is unavailable or process exits quickly
sample-quick.sh --launch -d 10 -- ./build/io_server
```

## Optional: GPU Profiling (Metal)

Use only when profiling confirms the workload is GPU-bound (e.g. large IOKit/IOAccelerator regions, Metal command-buffer activity).

### Quick GPU Loop

```bash
# One-command GPU profiling (Metal System Trace)
xtrace --gpu -d 10 ./my_app --benchmark

# Enable Shader Timeline for real shader tooling
TRACE=$(xtrace --gpu --shader-timeline --no-summary -d 10 ./my_shader_app)
trace-shader.py info "$TRACE"
trace-shader.py hotspots "$TRACE"
trace-shader-flamegraph.sh "$TRACE" -o shader.svg
trace-shader-speedscope.sh "$TRACE"

# Broader Metal/game trace
xtrace -t 'Game Performance' -d 10 ./my_metal_app

# Custom Metal instrument set
trace-record.sh --instrument GPU --instrument 'Metal Application' -d 10 -- ./my_metal_app

# Record now, analyze later
TRACE=$(xtrace --gpu --no-summary -d 10 ./my_app)
trace-gpu.py "$TRACE"                                # human summary
trace-gpu.py "$TRACE" --json > gpu_report.json      # machine-readable

# Launcher process differs from worker process name
xtrace --gpu --gpu-process my_worker ./launcher
```

In **GPU mode** (`--gpu` / `Metal System Trace`), `xtrace` keeps the Metal trace and runs `trace-gpu.py` summary (no sample fallback).

### Deep GPU + CPU Correlation

```bash
trace-record.sh -t 'Metal System Trace' -d 10 -- ./my_app
trace-record.sh -t 'Metal System Trace' --shader-timeline -d 10 -- ./my_shader_app
trace-record.sh --instrument GPU --instrument 'Metal Application' -d 10 -- ./my_metal_app
trace-gpu.py recording.trace
trace-shader.py hotspots recording.trace
trace-analyze.py summary recording.trace --top 20
```

`trace-gpu.py` reports:
- **GPU state utilization**: Active vs Idle ratios
- **GPU performance states**: Minimum/Medium/etc. residency when the trace contains them
- **Metal app activity**: application intervals, command-buffer submissions, encoder cadence
- **Shader visibility**: shader inventory, plus shader-timeline rows when the trace exposes them
- **Latency correlation**: CPU→GPU start latency and submission→completion latency
- **GPU ownership**: target process share vs competing processes (WindowServer, browser GPU helpers, etc.)
- **Driver/counter insight**: driver phases plus GPU-counter metadata / aggregated intervals when available

`trace-shader.py` adds the real shader-profiler layer when Shader Timeline rows are present:
- **Shader hotspots** from `metal-shader-profiler-intervals`
- **Callsite / PC trees** from shader-profiler rows and samples
- **Collapsed stacks / flamegraphs** via `trace-shader.py collapsed`, `trace-shader-flamegraph.sh`, or `trace-shader-speedscope.sh`

Some devices and templates expose shader/counter metadata without interval rows. The tools surface that explicitly instead of failing silently.

## Troubleshooting

| Problem | Fix |
|---|---|
| `xctrace not found` | `xcode-select --install` |
| No CPU samples in Time Profiler | `xtrace` auto-falls back to `sample` in CPU mode |
| High wall time, low CPU in summary | Record System Trace; inspect blocked threads and syscalls in Instruments.app |
| Unsymbolicated frames | Rebuild with `-g` |
| Missing GPU rows in `trace-gpu.py` | Ensure template is `Metal System Trace` (`xtrace --gpu ...`) |
| Allocations trace empty in CLI | Normal — use `trace-memory.py` or open in Instruments.app |
| `leaks` needs backtraces | Launch with `MallocStackLogging=1` (automatic in trace-memory.py) |
| Permission denied for vmmap | Run with `sudo` or profile your own processes |
| Process exits too fast | Increase duration or add a sleep/wait in target app |
