# LoCoMo conv-47 Pass 7: Unified Evidence Bundles + Uncapped System-2 + Scorer Parity Benchmark Report

- **Date**: 2026-09-21T18:10:12.701Z
- **Dataset**: conv-47 (31 sessions, 689 turns, 150 non-adversarial QA pairs)
- **Duration**: 154.13s
- **Architecture**:
  - **Span Extraction**: Needle 2 WASM (Cactus SAN 45M on CPU)
  - **Triage & Cognitive Scope**: TypeSafe Jev System-1 API multi-field schema (`category`, `temporal_subtype`, `search_scope`)
  - **Reranking**: Batched TypeSafe Jev System-1 API (`jev-latest`, batched 10-15 candidates / call)
  - **Conversational Window Hydration**: Verbatim 3-turn dialogue window context (`[D{s}:{t-1}, D{s}:{t}, D{s}:{t+1}]`)
  - **Unified Evidence Bundling**: Shared session-diversified candidate pool across System-1 Span Reader and System-2
  - **Uncapped System-2 Context**: 6000-char evidence budget with explicit turn IDs and session dates
  - **Temporal Arithmetic**: Jev-Governed Calendar Arithmetic & Greeting-Filtered Duration Extraction
  - **Deductive Synthesis (System-2)**: Ultra-Concise Batched DeepSeek Flash via OpenCode Go with strict token/polar constraints
  - **Entity Hierarchy**: Jev Hierarchical Place Resolution Tree (Real vs Fictional -> Country -> State)
  - **Storage**: In-Memory Entity Ledger with Graph Traversal

## 1. Top-Line Scorecard

| Metric | Baseline (Regex) | Pass 1 (Laya Coprocessor) | Pass 7 (Unified Evidence + Uncapped S2) | Pass 7 vs Pass 1 Delta |
| :--- | :--- | :--- | :--- | :--- |
| **Evidence Recall@3** | 38.42% | 45.32% | **55.67%** | **+10.34%** |
| **Official Upstream F1** | 6.43% | 8.71% | **53.70%** | **+44.99%** |
| **Legacy Token F1** | 6.63% | 8.29% | **53.19%** | **+44.90%** |
| **Overall BLEU-1** | 4.90% | 5.71% | **47.12%** | **+41.41%** |
| **Multi-Hop (C1) Upstream F1** | 3.32% | 6.52% | **50.26%** | **+43.74%** |
| **Temporal (C2) Upstream F1** | 0.74% | 1.43% | **55.13%** | **+53.70%** |
| **Detective (C3) Upstream F1** | 3.86% | 1.28% | **42.06%** | **+40.78%** |
| **Literal (C4) Upstream F1** | 9.92% | 13.38% | **55.76%** | **+42.38%** |
