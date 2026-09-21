# LoCoMo conv-47 Pass 6: Jev Cognitive Triage + Turn Window Hydration + System-2 Precision Benchmark Report

- **Date**: 2026-09-21T17:23:42.273Z
- **Dataset**: conv-47 (31 sessions, 689 turns, 150 non-adversarial QA pairs)
- **Duration**: 184.85s
- **Architecture**:
  - **Span Extraction**: Needle 2 WASM (Cactus SAN 45M on CPU)
  - **Triage & Cognitive Scope**: TypeSafe Jev System-1 API multi-field schema (`category`, `temporal_subtype`, `search_scope`)
  - **Reranking**: Batched TypeSafe Jev System-1 API (`jev-latest`, batched 10-15 candidates / call)
  - **Conversational Window Hydration**: Verbatim 3-turn dialogue window context (`[D{s}:{t-1}, D{s}:{t}, D{s}:{t+1}]`)
  - **Multi-Session Candidate Expansion**: Autonomous session diversity up to 6 distinct sessions for list/aggregation queries
  - **Temporal Arithmetic**: Jev-Governed Calendar Arithmetic & Duration Extraction (strips ad-hoc regex overrides)
  - **Deductive Synthesis (System-2)**: Ultra-Concise Batched DeepSeek Flash via OpenCode Go with strict token/polar constraints
  - **Entity Hierarchy**: Jev Hierarchical Place Resolution Tree (Real vs Fictional -> Country -> State)
  - **Storage**: In-Memory Entity Ledger with Graph Traversal

## 1. Top-Line Scorecard

| Metric | Baseline (Regex) | Pass 1 (Laya Coprocessor) | Pass 6 (Jev Triage + Window + S2 Precision) | Pass 6 vs Pass 1 Delta |
| :--- | :--- | :--- | :--- | :--- |
| **Evidence Recall@3** | 38.42% | 45.32% | **55.17%** | **+9.85%** |
| **Official Upstream F1** | 6.43% | 8.71% | **49.13%** | **+40.42%** |
| **Legacy Token F1** | 6.63% | 8.29% | **48.92%** | **+40.63%** |
| **Overall BLEU-1** | 4.90% | 5.71% | **42.17%** | **+36.46%** |
| **Multi-Hop (C1) Upstream F1** | 3.32% | 6.52% | **45.88%** | **+39.37%** |
| **Temporal (C2) Upstream F1** | 0.74% | 1.43% | **50.58%** | **+49.15%** |
| **Detective (C3) Upstream F1** | 3.86% | 1.28% | **43.61%** | **+42.33%** |
| **Literal (C4) Upstream F1** | 9.92% | 13.38% | **50.19%** | **+36.81%** |
