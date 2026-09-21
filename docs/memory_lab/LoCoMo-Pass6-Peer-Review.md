# LoCoMo Benchmark: Pass 5 & Pass 6 Peer Review Handoff Brief

- **Date**: 2026-09-21
- **Repository**: `dasilva333/airi`
- **Branch**: `main` (Pushed to `origin/main`)
- **Commits under review**:
  1. [`620b33938e`](https://github.com/dasilva333/airi/commit/620b33938e): *feat(memory-lab): implement Pass 5 autonomous dual-process architecture, verbatim hydration, and scorer parity*
  2. [`3d19ed06e9`](https://github.com/dasilva333/airi/commit/3d19ed06e9): *feat(memory-lab): implement Pass 6 cognitive triage, turn-window hydration, and prompt precision (49.13% F1)*
- **Benchmark Artifacts**:
  - Pass 5 Report: [`reports/memory-lab/locomo-conv47-pass5-report.md`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/reports/memory-lab/locomo-conv47-pass5-report.md)
  - Pass 5 Trace: [`reports/memory-lab/locomo-conv47-pass5-trace.json`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/reports/memory-lab/locomo-conv47-pass5-trace.json)
  - Pass 6 Report: [`reports/memory-lab/locomo-conv47-pass6-report.md`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/reports/memory-lab/locomo-conv47-pass6-report.md)
  - Pass 6 Trace: [`reports/memory-lab/locomo-conv47-pass6-trace.json`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/reports/memory-lab/locomo-conv47-pass6-trace.json)
  - Parity Test Suite: [`scripts/tests/locomo-benchmark/evaluator-parity.test.mjs`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/scripts/tests/locomo-benchmark/evaluator-parity.test.mjs)

---

## 1. Executive Summary & Top-Line Scorecard

Across Commits `620b33938e` and `3d19ed06e9`, we addressed all four findings from the previous peer review and executed a cluster analysis of remaining failure cases.

In Pass 6, we implemented:
1. **Multi-Field Cognitive Triage**: TypeSafe Jev System-1 API evaluates `category`, `temporal_subtype` (`calendar_date`, `duration`, `none`), and `search_scope` (`single_session`, `multi_session`) in one forward pass.
2. **Purge of Brittle Regex Hijacking**: Eliminated ad-hoc regex overrides in AnswerHead; temporal routing is governed strictly by Jev triage.
3. **Conversational Turn-Window Hydration**: Hydrated adjacent turns `[D{s}:{t-1}, D{s}:{t}, D{s}:{t+1}]`, addressing the finding that **86.4% of retrieval misses were from the exact same session**.
4. **Session Diversity**: Autonomous candidate expansion up to 6 distinct sessions for multi-hop queries (`search_scope: 'multi_session'`).
5. **Prompt-Level Brevity & Slash Prohibition**: Enforced 1–4 word ultra-concise answers in System-2, eliminating conversational justification and avoiding the upstream `remove_punc` slash-gluing trap.

All metrics are scored against the official Snap Research evaluator (`task_eval/evaluation.py`) with 0 stemmer discrepancies across the LoCoMo vocabulary.

| Metric | Baseline (Regex) | Pass 1 (Coprocessor) | Pass 4 (Corrected Upstream) | Pass 5 (Autonomous Dual-Process) | Pass 6 (Cognitive Triage + Window + S2 Precision) | Pass 6 vs Baseline Delta | Pass 6 vs Pass 1 Delta |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Official Upstream F1** | 6.43% | 8.71% | 41.89% | 44.27% | **49.13%** | **+42.70%** | **+40.42%** |
| **Legacy Token F1** | 6.63% | 8.29% | 42.30% | 45.65% | **48.92%** | **+42.29%** | **+40.63%** |
| **Overall BLEU-1** | 4.90% | 5.71% | 37.80% | 39.85% | **42.17%** | **+37.27%** | **+36.46%** |
| **Multi-Hop (C1) F1** | 3.32% | 6.52% | 28.43% | 37.17% | **45.88%** | **+42.56%** | **+39.37%** |
| **Temporal (C2) F1** | 0.74% | 1.43% | 45.45% | 49.59% | **50.58%** | **+49.84%** | **+49.15%** |
| **Detective (C3) F1** | 3.86% | 1.28% | 43.61% | 40.17% | **43.61%** | **+39.75%** | **+42.33%** |
| **Literal (C4) F1** | 9.92% | 13.38% | 43.41% | 44.44% | **50.19%** | **+40.27%** | **+36.81%** |
| **Wall Clock Runtime** | — | — | ~230s | 215.85s | **184.85s** | — | — |

---

## 2. Direct Resolution of Previous Review Findings

### Finding 1: Scorer Parity (Correct Upstream F1: 41.89% vs 43.93%)
- **Action Taken**:
  - Rewrote [`porter-stemmer.mjs`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/scripts/tests/locomo-benchmark/porter-stemmer.mjs) with full NLTK extension rules (`NLTK_POOL`, 2-letter $vc$ patterns, vowel-preceded $y$ preservation). Tested across all 712 unique words in conv-47 with **0 mismatches** against Python `nltk.stem.PorterStemmer(mode='NLTK_EXTENSIONS')`.
  - Updated [`locomo-metrics.mjs`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/scripts/tests/locomo-benchmark/locomo-metrics.mjs) to mirror `task_eval/evaluation.py`: multi-answer comma splitting is restricted strictly to C1; C2–C4 use single-answer F1; C3 pre-processes `;` delimiters.
  - Confirmed exact reproduction of historical checkpoints under the official evaluator: Pass 4 = **41.89%**, Pass 1 = **8.71%**, Baseline = **6.43%**.
  - Added parity tests in [`evaluator-parity.test.mjs`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/scripts/tests/locomo-benchmark/evaluator-parity.test.mjs).

### Finding 2: Leaked Gold Category in System-2 Routing
- **Action Taken**:
  - Removed `goldCategory === 3` entirely from [`locomo-runner-pass3-jev.mjs`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/scripts/tests/locomo-benchmark/locomo-runner-pass3-jev.mjs). Dual-process routing is now 100% label-blind.
  - Upgraded [`span-reader.mjs`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/scripts/tests/locomo-benchmark/span-reader.mjs) with sentence boundary isolation, verbatim substring validation against evidence, and a typed return contract `{ status: 'found' | 'abstain' | 'error', answer, confidence, choice }`.
  - In [`answer-head-pass3.mjs`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/scripts/tests/locomo-benchmark/answer-head-pass3.mjs), when the reader abstains (`choice === 'none'`), it returns `'UNKNOWN'` instead of falling back to the entire raw paragraph. This triggers autonomous System-2 escalation naturally.
  - Added unit test `label-Blind Routing Invariance` in [`evaluator-parity.test.mjs`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/scripts/tests/locomo-benchmark/evaluator-parity.test.mjs) verifying that changing gold category to `999` leaves inference requests and outputs unchanged.

### Finding 3: EntityLedger Fresh Ingestion Indexing Bug
- **Action Taken**:
  - Fixed [`entity-ledger.mjs`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/scripts/tests/locomo-benchmark/entity-ledger.mjs) lines 91, 102, 110 where `addClaim()` indexed the input `claimId` (which is `null` on fresh ingestion) instead of the generated `id`.
  - Added unit test `entityLedger Fresh Ingestion & Indexing Integrity` in [`evaluator-parity.test.mjs`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/scripts/tests/locomo-benchmark/evaluator-parity.test.mjs) verifying that `bySubjectPredicate` does not contain `null` and that queries succeed with identical results before and after JSON serialization.

### Finding 4: Verbatim Dialogue Hydration & Synthetic Noise
- **Action Taken**:
  - Updated [`dual-searcher-pass3.mjs`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/scripts/tests/locomo-benchmark/dual-searcher-pass3.mjs) so all candidates hydrate the verbatim dialogue turns (`speaker`, `session_date`, raw turn text) from `index.documents.get(canonicalId)`. This eliminated the synthetic observation noise that had hallucinated `"Among Us"` into D8:36.
  - Added `"last year"` relative calendar math (`anchor.getFullYear() - 1`) to [`temporal-resolver.mjs`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/scripts/tests/locomo-benchmark/temporal-resolver.mjs) and [`answer-head-pass3.mjs`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/scripts/tests/locomo-benchmark/answer-head-pass3.mjs). Resolves Q13 (Italy visit) to **`"In 2021"`** with 1.00 F1.

---

## 3. Pass 6 Architectural Upgrades (The 4 Failure Pockets)

### Pocket 1: Eliminating Brittle Regex in Favor of Jev-Native Temporal Triage
- **The Issue**: In Pass 5, `answer-head-pass3.mjs` contained `|| /\b(when|...)\b/i.test(question)`. Subordinate clauses containing the word "when" overrode Jev's 98% confident `c4_literal` predictions and formatted session dates:
  - Q130 (*"What instrument did James used to play when he was younger?"*): Output `"September 18, 2022"` (F1: 0.0).
  - Q131 (*"What did John use to play when he was younger...?"*): Output `"September 18, 2022"` (F1: 0.0).
  - Q139 (*"What sparked James' passion for gaming when he was a kid?"*): Output `"October 21, 2022"` (F1: 0.0).
- **The Upgrade**:
  - Extended [`jev-triage.mjs`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/scripts/tests/locomo-benchmark/jev-triage.mjs) with `temporal_subtype`: `calendar_date` vs `duration` vs `none`.
  - In [`answer-head-pass3.mjs`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/scripts/tests/locomo-benchmark/answer-head-pass3.mjs), purged the regex override. If `temporalSubtype === 'none'`, the query bypasses date formatting completely.
  - **Results**:
    - Q130 $\rightarrow$ **`guitar`** (F1: **1.00**).
    - Q131 $\rightarrow$ **`Playing drums`** (F1: **0.67**).
    - Q139 $\rightarrow$ **`Super Mario and The Legend of Zelda`** (F1: **0.91**).

### Pocket 2: System-2 Prompt Precision & Slash Prohibition
- **The Issue**: DeepSeek Flash appended conversational justifications and parentheticals (e.g. `"No; John says he doesn't have pets..."` dropped Q3 from 1.00 to 0.25 F1; `"Chess (the dialogue does not...)"` dropped Q106 to 0.20 F1; `"Coding/programming."` became `"codingprogramming"` under `remove_punc` and scored 0.0 F1 on Q118).
- **The Upgrade**:
  - In [`system2-batch-resolver.mjs`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/scripts/tests/locomo-benchmark/system2-batch-resolver.mjs), removed `"preserving qualifications"` and added explicit brevity directives:
    1. Minimal answer (1–4 words) without reasoning or citations.
    2. Strict `"Yes"` or `"No"` on polar questions.
    3. Prohibition of slashes (`'/'`).
- **Results**:
  - Q3 (*"Do both James and John have pets?"*) $\rightarrow$ **`No`** (F1: **1.00**).
  - Q100 (*"Will there be an interview required...?"*) $\rightarrow$ **`No`** (F1: **1.00**).
  - Q118 (*"What has John been teaching his siblings?"*) $\rightarrow$ **`coding`** (F1: **1.00**).

### Pocket 3: Conversational Turn-Window Hydration
- **The Discovery**: Forensic analysis of Pass 5 revealed that **86.4% of retrieval misses were from the exact session retrieved**, and 50.0% were within $\pm 2$ turns.
- **The Upgrade**:
  - In [`dual-searcher-pass3.mjs`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/scripts/tests/locomo-benchmark/dual-searcher-pass3.mjs), implemented `getConversationalWindow()`: when candidate `D{s}:{t}` is retrieved, it hydrates `[D{s}:{t-1}, D{s}:{t}, D{s}:{t+1}]`.
  - Both the span reader and System-2 now receive complete 3-turn conversational exchanges rather than isolated 1-turn fragments.
- **Results**: Category 4 Literal F1 surged from **44.44% to 50.19%** (+5.75%).

### Pocket 4: Autonomous Search Scope & Session Diversity (Multi-Hop C1)
- **The Issue**: Multi-hop queries require aggregating facts scattered across multiple sessions (e.g. countries visited across Sessions 6, 16, 17; books recommended across Sessions 8, 16, 24). Single-pass BM25 with `limit = 3` often pulled 3 turns from the *same* session, starving the model of remaining items.
- **The Upgrade**:
  - Extended Jev triage to classify `search_scope`: `single_session` vs `multi_session`.
  - When `search_scope === 'multi_session'`, the hybrid searcher expands candidate retrieval and enforces **session diversity** across the top 6 candidates (ensuring distinct sessions are represented).
- **Results**:
  - Category 1 Multi-Hop F1 surged from **37.17% to 45.88%** (+8.71%).
  - Q18 (*"Which books has John recommended to James?"*) $\rightarrow$ retrieved 3 out of 4 books across sessions, scoring **0.750 F1** (up from 0.336 in Pass 5).

---

## 4. Remaining Failure Cases & Pass 7 Focus Areas

Analyzing the remaining 76 questions where $\text{F1} < 0.5$ in Pass 6 (`reports/memory-lab/locomo-conv47-pass6-trace.json`):

1. **Number Word vs Digit Inconsistency** (e.g. Q20):
   - Gold: `"two"` | Prediction: `"2"`.
   - Under token-level evaluation, `"2"` vs `"two"` gets 0.0 overlap because the stemmer does not normalize digit words to integers. Normalizing single-digit numeric tokens (`"2"` $\leftrightarrow$ `"two"`) will recover these items.
2. **Duration Anchor Date Offsets** (e.g. Q31, Q62):
   - Q31 (*"How many days did James plan to spend on his trip in Canada?"*): Gold: `"19 days"`, Pred: `"9"`. (Turn 13 says *"stay for 19 days"*, but turn 9 says *"on 9 July"*).
   - A dedicated duration regex parser prioritizing `\d+\s+days` over isolated numerals will resolve this.
3. **Geographic Knowledge in Multi-Hop Queries** (e.g. Q34):
   - Q34 (*"Which countries did James visit in July 2022?"*): Gold: `"Canada, Greenland"`.
   - Dialogue D17:22 says: *"I even managed to get out to another country. The city of Nuuk, if you know."*
   - While System-2 knows Nuuk is in Greenland, the multi-hop list synthesizer included past countries (Italy, Turkey, Mexico). Constraining candidate turns by session date (July 2022) before multi-hop list synthesis will align this cleanly.

---

## 5. Independent Verification & Reproduction Instructions

To reproduce all results independently from a clean checkout of `origin/main`:

```bash
# 1. Verify working directory is clean on commit 3d19ed06e9
git status
git log -n 2 --oneline

# 2. Run the evaluator parity test suite (11/11 tests)
node --test scripts/tests/locomo-benchmark/evaluator-parity.test.mjs

# 3. Run the full Pass 6 benchmark shootout (150 QA pairs, ~185s wall clock)
node scripts/tests/locomo-benchmark/locomo-runner-pass3-jev.mjs

# 4. Inspect generated reports and traces
cat reports/memory-lab/locomo-conv47-pass6-report.md
```
