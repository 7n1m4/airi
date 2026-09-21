# AIRI Memory Lab: Architectural Genealogy & Metric Trajectory

This document provides a deep-dive into the iterative optimization of the AIRI Memory system. It tracks the core performance metrics (F1, LLM Judge, Category-specific recall) and the architectural breakthroughs that enabled each leap.

## 📊 The Performance Matrix

| Era | Run | Flavor | Overall F1 | LLM Judge | C3 (Open) | C2 (Temp) | Primary Evolution |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Naive** | **01** | Gemini | ~12.00% | --- | 0.00% | 0.00% | Raw Orama hybrid search on unstructured chunks. |
| | **02** | Gemini | 30.94% | 63.33% | 2.21% | 19.33% | **Conciseness Prompting**: Alignment with LoCoMo span-exactness. |
| | **03** | Gemini | 33.84% | 64.33% | 1.18% | 18.06% | **Regex Boosting**: Manual keyword/room relevance multipliers. |
| **Fact-Base**| **04** | Gemini | 27.64% | 55.67% | 1.18% | 11.23% | **PCL Extraction**: Atomic fact extraction (The "Resolution" shift). |
| **Weighted** | **05** | Gemini | 33.56% | 68.33% | 1.92% | 3.13% | **Weighted RRF**: First pass at Reciprocal Rank Fusion. |
| **Merger** | **06** | Gemini | 41.29% | 68.67% | 5.46% | 29.90% | **Abstraction Layer**: Session & Profile synthesis. |
| **Orchestra**| **07** | ChatGPT| **46.89%** | **74.00%** | 9.48%| 45.74% | **Surgical Search Plans**: 10-query search strategy (The "Thinking" Tax). |
| **Airi-Mem**| **08** | Gemini | 41.54% | 72.33% | 5.06% | 28.34% | **Cognitive Storage**: High-fidelity extraction (+55% yield) but high pollution. |
| **Analysis** | **09** | ChatGPT| **47.50%**| **76.67%**| 6.51% | 44.43% | **Pipeline Hardening**: Refactored metrics and 79m "Thinking" pass. |
| **Fusion**   | **10** | Qwen   | 10.97% | 48.00% | 3.14% | 22.13% | **Wash**: Model unloads + conciseness violations (Run 13 targets fix). |
| **Cognitive**| **11** | Gemini | 42.74% | 74.00% | 6.75% | 24.88% | **Synthesis Pass**: Interpretation drafts. High C1 (+8pt), but C2 regression. |
| **Detective** | **13** | Qwen   | **1.00%** | **73.00%** | 0.90% | 0.00% | **Cache Collision**: 100-char key failure + omitted logic. |
| **Detective** | **14A**| Gemini | 29.21% | 74.00% | **13.54%**| 0.00% | **5W Era**: High-inference and 5W extraction. Record C3, but fatal C2 leak + JSON crashes. |
| **Hardened**  | **14B**| Gemini | 27.36% | 65.33% | 7.09% | **18.03%**| **Foundation Fix**: Schema hardening and token expansion. C2 recovered; C3 suppressed by discipline. |
| **Abstract** | **15** | ChatGPT| **Regress**| --- | --- | --- | **Over-Integrated**: Abstraction noise drowned out literal facts + extraction slop. |
| **Hybrid SOTA**| **16** | ChatGPT| 39.22% | 72.00% | 8.95% | 15.03% | **Ultimate Hybrid**: Tiered Router (09 Spine + Gated 11/14 hatches). Strong literal spine, but routing remained too conservative to unlock major C1/C3 gains. |
| **System-1**  | **Pass 2** | Laya/Needle | 12.29% | --- | 10.70% | 4.61% | **Entity Ledger**: Cactus SAN 45M WASM extraction + in-memory graph. C1 jumped to 17.89%. |
| **System-1**  | **Pass 3** | Jev/Needle  | **18.95%** | --- | **19.62%** 🏆 | 8.16% | **Full Jev S1**: Batched Jev reranking (57.14% recall) + Hierarchical Place Tree. **C1 (30.05%) & C3 (19.62%) All-Time Records** in 128s. |


---

## 🧬 Architectural Genealogy: Run-by-Run Deep Dive

### Era 1: The Heuristic Foundation (Runs 01–03)
*   **The Problem**: Memory was just a flat database of chat messages.
*   **The Fix**: Early versions focused purely on "Retrieval Signal." We added multipliers for speaker names and common "room" keywords.
*   **Metric Impact**: Lifted F1 from 12% to 33%, but **Temporal Recall (C2)** remained almost non-existent because the model had no "time sense."

### Era 2: The Resolution Shift (Run 04)
*   **The Problem**: Large chat chunks introduced too much semantic noise.
*   **The Fix**: Implemented **PCL Fact Extraction**, turning messy turns into atomic facts (e.g., *"Sam hates pickles"*).
*   **The Regression**: Overall F1 dropped to 27%. **Why?** Our retrieval engine was tuned for "Wide" text. When the data became "Fine," our 1-pass search missed the links. This taught us that **Atomic Data requires Advanced Orchestration.**

### Era 3: The Great Merger (Run 06)
*   **The Problem**: Facts alone don't provide context for "Who is Sam?" or "What happened this month?"
*   **The Fix**: Introduced **Session & Profile Summaries**.
    - **Session Summaries**: Narrative bridge between chat turns.
    - **Profile Synthesis**: A central "bio" for every speaker.
*   **Metric Impact**: Broken the 40% F1 barrier. Category 2 (Temporal) jumped from 3% to 29% because we suddenly had "Era-level" context.

### Era 4: The ChatGPT Sandbox (Run 07)
*   **The Problem**: One search doesn't find multi-hop answers.
*   **The Fix**: **Surgical Search Plans**.
    - Instead of one prompt, the model generated **10 sub-queries** (e.g., "Sam's job", "Sam's commute").
    - Results were merged via a heavy RRF pass.
*   **Metric Impact**: **Historical Peak (46.89%)**. Temporal recall hit a record 45%.
*   **The Cost**: Latency increased by 18 minutes. It was "Smart but Slow."

### Era 5: The "Cognitive" Tradeoffs (Run 08–11)
*   **The Problem**: We hit a ceiling where optimizing for one category (Reasoning) broke another (Temporal).
*   **Run 8 (Gemini - Airi-Mem)**: Yielded 55% more facts, raising the LLM Judge Accuracy to **72.33%**, but diluting exact-match precision (F1 dropped to 41.54%) because it retrieved too much noise.
*   **Run 11 (Gemini - Synthesis)**: Implemented an intermediate interpretation pass. This triggered a **Multi-Hop (C1) record (25.20%)**, but caused a **Catastrophic C2 Regression (24.88%)**. We learned that "Reasoning Vibes" drown out "Surgical Timelines."

### Era 6: The Meltdown (Run 13)
*   **The Flavor**: Qwen Fusion.
*   **The Failure**: A "Cheating Cache" bug (key collision on the first 100 chars) caused the model to return the same answer for 150 questions. Combined with "omitted for brevity" logic, it resulted in a total collapse of knowledge retrieval.
*   **Lesson**: Local model engineering requires rigorous schema verification and non-lazy extraction.

### Era 7: The "Analytical Detective" (Runs 14A/14B)
*   **The Flavor**: Gemini Pro/Flash (5W Era).
*   **The Breakthrough (14A)**: Hit a **Category 3 record (13.54%)** by using 5W extraction and deductive synthesis. It inferred complex traits (e.g., "Obesity") from literal clues ("Fat fingers").
*   **The Hardening (14B)**: Recovered the **Category 2 (Temporal)** engine from 0% back to 18% via mandatory temporal schema grounding.
*   **The Conflict**: 14B proved that **Discipline suppresses Inference**—by forcing the model to be stable, we lost the record-high C3 "detective" hits.

### Era 8: The Regression Lessons (Run 15)
*   **The Problem**: ChatGPT attempted "Global Abstraction" (Tiered Normalization).
*   **The Result**: Total regression. The model became "too smart," applying abstract concepts to literal questions, which caused it to miss plain factual answers (Cat 4) and temporal anchors (Cat 2). It taught us that **Normalization must be gated, not default.**

### Era 9: The Ultimate Hybrid (Run 16)
*   **The Strategy**: **"Reason Broadly, Answer Narrowly."**
*   **Architecture**:
    - **Run 09 Spine**: Literal precision as the default path.
    - **Run 11 Bridge**: Semantic expansion hatches for Multi-Hop (C1).
    - **Run 14A Detective**: Deductive inference hatches for Open-Domain (C3).
*   **Metric Impact**: Landed at **39.22% F1 / 72.00% LLM** overall. Category performance was **11.10% C1**, **15.03% C2**, **8.95% C3**, and **60.66% C4**.
*   **What Worked**: The literal spine held up, preserving strong single-hop precision and validating the routed architecture as a stable base.
*   **What Failed To Break Through**: Bridge remained underpowered for multi-hop, Detective routing was too conservative for open-domain, temporal performance stayed inconsistent, and normalization still showed structured-output brittleness.
*   **Lesson**: The remaining bottleneck is now primarily routing and activation policy rather than the absence of a viable top-level architecture.

### Era 10: The System-1 Cognitive Era (Pass 2 & Pass 3)
*   **The Paradigm Shift**: Transition from passive, multi-minute generative LLM RAG pipelines to **non-autoregressive System-1 coprocessors** paired with an **In-Memory Entity Ledger**.
*   **Architecture**:
    - **Needle 2 WASM (Cactus SAN 45M)**: Ultra-fast local span extraction for entities, events, and dates directly from raw dialogue turns (~120ms).
    - **TypeSafe Jev System-1 API**: Cloud discriminative classifier handling Zero-Shot Triage (C1–C4), Hierarchical Entity Resolution (Real vs Fictional -> Country -> State), and Batched Candidate Cross-Encoder Reranking (10 candidates scored in parallel in ~350ms).
    - **Entity Ledger Graph**: Persistent typed graph joining entities, proof bundles, and attributes across conversations.
*   **Metric Impact**:
    - **Evidence Recall@3 hit 57.14%** (All-Time Record, beating baseline 38.42% and Pass 1 45.32%).
    - **C1 Multi-Hop reached 30.05% F1** (All-Time Record, beating Run 11's 25.20% and Run 16's 11.10%).
    - **C3 Detective reached 19.62% F1** (All-Time Record, shattering Run 14A's 13.54%).
    - **Total Latency**: All 150 questions completed in **128 seconds (~2 minutes)**, compared to 18–79 minutes in the heavy prompt eras.

---

## 🏁 The Lab State (2026-09-21)
1. **Pass 2**: COMPLETE. Cactus SAN 45M WASM extraction + Entity Ledger in-memory graph.
2. **Pass 3**: COMPLETE. Full TypeSafe Jev Architecture (Batched Reranking + Hierarchical Place Tree). Established all-time records in C1, C3, and Evidence Recall.
3. **Next Move**: Bridge the C2 temporal gap against Run 07 (without 18-minute thinking loops) and close the C4 token brevity gap against Run 16 using local generative span trimming.

