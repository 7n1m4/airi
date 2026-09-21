# LoCoMo conv-47 Pass 8: Jev In-Session Semantic Distillation & Clean Dual-Process Architecture Benchmark Report

- **Date**: 2026-09-21T18:53:14.522Z
- **Dataset**: conv-47 (31 sessions, 689 turns, 150 non-adversarial QA pairs)
- **Duration**: 264.37s
- **Architecture**:
  - **In-Session Semantic Distillation**: Jev System-1 (`type: 'choice'`) dynamic turn distillation over session candidate pool
  - **Clean Dual-Process Routing**: System-1 deterministic graph & date-fns arithmetic; clean UNKNOWN abstention
  - **Auto-Escalation**: Multi-hop list queries (Category 1 / `multi_session`) escalate directly to System-2
  - **Triage & Cognitive Scope**: TypeSafe Jev System-1 API multi-field schema (`category`, `temporal_subtype`, `search_scope`)
  - **Reranking**: Batched TypeSafe Jev System-1 API (`jev-latest`, batched 10-15 candidates / call)
  - **Conversational Window Hydration**: Verbatim 3-turn dialogue window context (`[D{s}:{t-1}, D{s}:{t}, D{s}:{t+1}]`)
  - **Unified Evidence Bundling**: Shared session-diversified candidate pool across System-1 and System-2
  - **Uncapped System-2 Context**: 6000-char evidence budget with explicit turn IDs and session dates
  - **Temporal Arithmetic**: Jev-Governed Calendar Arithmetic & Greeting-Filtered Duration Extraction
  - **Deductive Synthesis (System-2)**: Ultra-Concise Batched DeepSeek Flash via OpenCode Go with strict token/polar constraints
  - **Entity Hierarchy**: Jev Hierarchical Place Resolution Tree (Real vs Fictional -> Country -> State)
  - **Storage**: In-Memory Entity Ledger with Graph Traversal

## 1. Top-Line Scorecard

| Metric | Baseline (Regex) | Pass 1 (Laya Coprocessor) | Pass 8 (Jev Distillation + Clean S2) | Pass 8 vs Pass 1 Delta |
| :--- | :--- | :--- | :--- | :--- |
| **Evidence Recall@3** | 38.42% | 45.32% | **66.50%** | **+21.18%** |
| **Official Upstream F1** | 6.43% | 8.71% | **70.20%** | **+61.50%** |
| **Legacy Token F1** | 6.63% | 8.29% | **69.60%** | **+61.31%** |
| **Overall BLEU-1** | 4.90% | 5.71% | **64.39%** | **+58.68%** |
| **Multi-Hop (C1) Upstream F1** | 3.32% | 6.52% | **65.42%** | **+58.91%** |
| **Temporal (C2) Upstream F1** | 0.74% | 1.43% | **60.14%** | **+58.71%** |
| **Detective (C3) Upstream F1** | 3.86% | 1.28% | **44.62%** | **+43.34%** |
| **Literal (C4) Upstream F1** | 9.92% | 13.38% | **79.49%** | **+66.11%** |
