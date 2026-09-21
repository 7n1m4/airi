# LoCoMo Pass 3: Full TypeSafe Jev Architecture & System-1 Cognitive Engine

- **Author**: AIRI Memory Lab
- **Date**: 2026-09-21
- **Status**: Shipped & Benchmarked
- **Commit**: (Referenced in git log)
- **Dataset**: `conv-47` (31 sessions, 689 dialogue turns, 150 non-adversarial QA pairs)

---

## 1. Executive Summary

Pass 3 represents a fundamental paradigm shift in the AIRI Memory Architecture. We replaced passive, high-latency multi-query generative RAG pipelines with an active **System-1 Cognitive Architecture**:
1. **Needle 2 WASM (Cactus SAN 45M)** running locally on CPU in ~120 ms for extractive span anchoring.
2. **TypeSafe Jev System-1 API (`jev-latest`)** for zero-shot question triage, hierarchical entity disambiguation, and batched cross-encoder candidate reranking.
3. **In-Memory Entity Ledger** providing secondary-indexed relational graph traversal, coreference resolution, and proof bundle aggregation.

The entire 150-question benchmark executed in **128.37 seconds (~2.1 minutes)**, achieving **two new all-time lab records** and breaking the **57% evidence recall barrier**.

---

## 2. Top-Line Scorecard

| Metric | Baseline (Regex+BM25) | Pass 1 (Laya Coprocessor) | Pass 2 (Entity Ledger) | **Pass 3 (Full Jev S1)** | Pass 3 vs Historical Peak |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Evidence Recall@3** | 38.42% | 45.32% | 44.33% | **57.14%** (116/203) | 🏆 **+11.82% All-Time Record** |
| **Overall Token F1** | 6.63% | 8.29% | 12.29% | **18.95%** | **+10.66% over Pass 1** |
| **Overall BLEU-1** | 4.90% | 5.71% | 9.80% | **14.61%** | **+8.90% over Pass 1** |
| **Multi-Hop (C1) F1** | 6.52% | 5.36% | 17.89% | **30.05%** | 🏆 **All-Time Record** *(vs Run 11: 25.20%)* |
| **Temporal (C2) F1** | 0.85% | 1.34% | 4.61% | **8.16%** | 📈 **6.1x Lift over Pass 1** *(Run 07: 45.74%)* |
| **Detective (C3) F1** | 3.69% | 1.37% | 10.70% | **19.62%** | 🏆 **All-Time Record** *(vs Run 14A: 13.54%)* |
| **Literal (C4) F1** | 9.49% | 12.93% | 14.33% | **20.59%** | 📈 **+7.66% over Pass 1** *(Run 16: 60.66%)* |
| **Total Duration** | ~35s | ~110s | ~430s (unbatched) | **128.37s** | ⚡ **~850 ms per question** |

---

## 3. Core Architectural Breakthroughs

### A. Batched Cross-Encoder Candidate Reranking
In Pass 1, candidate scoring was bottlenecked by a sequential loop of individual ONNX forward passes on CPU ($10 \text{ candidates} \times 150 \text{ questions} = 1,500 \text{ calls}$, taking >7 minutes).

In Pass 3, [`jev-rerank.mjs`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/scripts/tests/locomo-benchmark/jev-rerank.mjs) takes advantage of Jev's multi-question API contract:
* All 10 hybrid text candidates are bundled into a single request (`cand_0` through `cand_9`).
* Jev evaluates the entire batch in a single forward pass (~350 ms).
* Fused scoring ($70\%$ normalized Jev relevance $+ 30\%$ initial BM25/BGE retrieval score) boosted Evidence Recall@3 to **57.14%**, surfacing subtle STMM observations into the top 3 slots.

### B. Hierarchical Place Resolution Tree
To prevent brittle overfitting or massive ungrounded prompt lists, [`place-resolver.mjs`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/scripts/tests/locomo-benchmark/place-resolver.mjs) executes a dynamic, structured question tree:

```text
                     [ Entity: {place} ]
                              |
                 Is it a real place on Earth?
                              |
              +---------------+---------------+
              |                               |
          [ FALSE ]                        [ TRUE ]
              |                               |
       What fictional setting?         Which macro-region?
    (Video game, Fantasy book,      (North America, Europe, East Asia...)
       Anime, Tabletop...)                    |
              |                         Which country?
           [ DONE ]                     (USA, Canada, Japan...)
                                              |
                                    Which state / province?
                               (Connecticut, British Columbia, etc.)
                                              |
                                           [ DONE ]
```

* **Zero Gazetteer Required**: Classifies real cities (`Stamford -> USA -> New England -> Connecticut`, `Vancouver -> Canada -> British Columbia`, `Kyoto -> Japan`) and cleanly separates fictional realms (`Mondstadt -> video_game`, `Hogwarts -> fantasy_fiction`, `Night City -> video_game`).
* **Zero Hardcoded Regexes**: The Stamford/Connecticut cluster (Questions 6 & 7) scored $1.0\text{ F1}$ organically via graph attribute traversal.

### C. In-Memory Entity Ledger Traversal
The [`entity-ledger.mjs`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/scripts/tests/locomo-benchmark/entity-ledger.mjs) graph tracks entities, claims, proof bundles, and temporal anchors. Multi-hop questions like *"What are the names of James's dogs?"* and *"How many pets does James have?"* were resolved by joining Session 1 (`Daisy`, `Max`) and Session 5 (`Ned`) directly into graph proof sets, achieving **30.05% F1** on C1.

---

## 4. Comparison with Historical Peaks

### 1. The C3 Detective Victory (19.62% vs Run 14A's 13.54%)
* **Run 14A (Gemini 5W Era)**: Achieved 13.54% using heavy 5W generative prompts, but suffered fatal C2 temporal collapse (0%) and frequent JSON schema crashes.
* **Pass 3**: Achieved **19.62%** through structured ingestion. Because geographical facts and character attributes are stored as explicit entity properties, C3 deductive queries resolve with zero prompt bloat.

### 2. The C1 Multi-Hop Victory (30.05% vs Run 11's 25.20%)
* **Run 11 (Gemini Synthesis)**: Reached 25.20% by inserting an intermediate interpretation pass, but diluted literal retrieval.
* **Pass 3**: Achieved **30.05%** without any intermediate LLM synthesis step. The Entity Ledger naturally performs cross-session set aggregation.

### 3. The C2 Temporal Gap (8.16% vs Run 07's 45.74%)
* **Run 07 (ChatGPT Surgical Search Plans)**: Reached 45.74% by issuing **10 sub-queries per question** across conversation timelines. However, this required **18 minutes** of execution time (and Run 09 took **79 minutes**).
* **Pass 3**: Anchors relative time phrases ("last week", "three days ago") to session dates in 128 seconds total. To bridge the gap to Run 07, the ledger needs multi-session timeline indexing rather than isolated event timestamps.

### 4. The C4 Literal Brevity Gap (20.59% vs Run 16's 60.66%)
* **Run 16 (Hybrid SOTA)**: Achieved 60.66% by passing all retrieved passages through an LLM generation head that produced concise, token-exact answers.
* **Pass 3**: Evidence recall on C4 is high, but the Answer Head currently returns the verbatim raw conversation turn for unstructured literal questions. Because Token F1 penalizes wordy spans (comparing a 40-word dialogue turn to a 4-word gold span yields ~20% F1), adding an extractive span trimmer or local SLM head will immediately bridge this gap.

---

## 5. Peer Review Discussion Points

1. **Bridging the C2 Temporal Gap**:
   How can we achieve Run 07-level temporal sequencing using Needle WASM + Jev without incurring the 18-minute 10-query latency penalty? Can temporal event intervals (start_date, end_date, duration) be anchored as first-class edges in the Entity Ledger?
2. **Closing the C4 Token Brevity Gap**:
   What is the leanest strategy to trim recalled dialogue turns into exact concise answer spans? Should Needle 2 WASM's `complete()` be constrained with a span-extraction grammar, or should Jev extract the target noun phrase?
3. **Temporal Coreference & Event Role Modeling**:
   How should we model recurring activities across sessions (e.g. game design project progress across Sessions 1, 6, and 13) in the Ledger graph?
