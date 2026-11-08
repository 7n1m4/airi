# Agent Operating Guidelines

## 1. Domain Skills and Project Context

- **Start by identifying relevant domain skills.** At the beginning of a task, review the user's request and consult `.agents/skills/` and [`docs/project-specialized-skills.md`](./docs/project-specialized-skills.md) to identify the most relevant guidance. Read the associated `SKILL.md` files and useful references before substantial codebase exploration or implementation.
- Scale the depth of preparation to the task. For a trivial documentation edit, a short targeted review may be sufficient. For unfamiliar subsystems, architectural changes, or complex debugging, perform a more thorough review.
- Before broad architecture exploration or cross-cutting changes, consult the relevant section of [`docs/rosetta-stone.md`](./docs/rosetta-stone.md). It maps concepts to canonical code locations and documents known failure modes. If current source code contradicts the documentation, trust the source and update the documentation when the discrepancy reveals a durable lesson or changes a canonical entry point.
- Consult [`docs/data-catalog.md`](./docs/data-catalog.md) before adding, renaming, or changing persisted storage keys, including IndexedDB `local:*`/`outbox:*`, localforage assets, and localStorage settings. Update the catalog when the change affects its documented inventory.
- Consult [`docs/project-testing-parity.md`](./docs/project-testing-parity.md) before broad architectural changes, investigating apparent test gaps, or adding tests that might duplicate existing coverage. Run `node scripts/audit-test-catalog.mjs` when the catalog's integrity needs verification.
- Keep [`docs/project-specialized-skills.md`](./docs/project-specialized-skills.md) synchronized with the skills directory when adding or materially reorganizing domain skills.

## 2. Git Status and Change Awareness

- Keep track of the repository's state throughout the task. Run `git status` after each commit and after modifications that materially affect the working tree, particularly before handoff or any operation that depends on a clean or understood state.
- Report relevant remaining changes at handoff, distinguishing changes made for the task from pre-existing modifications. Include unstaged, staged, untracked, and otherwise pending files when they matter to the user's next decision.
- Do not assume that unrelated modifications are safe to ignore. Preserve work that is outside the current scope and avoid including it in a commit without authorization.

## 3. Pair Programming and User Intent

- Work collaboratively. Keep the user's stated goal, constraints, and preferences central to the implementation.
- Requests to explore, review, diagnose, research, design, plan, or discuss an idea generally authorize investigation and recommendations, not application-code changes. Explain the findings, root cause, proposed solution, and material tradeoffs before implementing a change that has not been requested.
- If the user asks for a design document, confine changes to that document unless implementation is also requested.
- For clearly specified, low-risk changes, proceed without unnecessary confirmation.
- For material product, behavior, data-model, or architectural decisions, explain the important decision and preferred approach first when the user could reasonably want to choose differently. Avoid turning routine implementation details into approval checkpoints.
- Ask questions when essential information is missing or when proceeding would risk an irreversible action, cross-project boundary violation, or significant unintended change. Otherwise, make reasonable assumptions, state them when useful, and continue.

## 4. Technical Accuracy and Evidence

- Prioritize source code, reproducible behavior, authoritative documentation, and empirical logs over assumptions or agreement for its own sake.
- When a user's technical premise appears inconsistent with the evidence, explain the discrepancy respectfully and directly. Identify the relevant files, code paths, documentation, or logs and show why they support a different conclusion.
- Distinguish verified facts from hypotheses and recommendations. If evidence is incomplete, explain the uncertainty and identify the smallest useful investigation or test that could resolve it.
- Do not silently accept an incorrect premise if doing so would lead to a defective implementation. Equally, do not overstate certainty when the available evidence does not establish a definitive answer.

## 5. Workspace and Repository Boundaries

- Keep repository exploration, searches, edits, and shell commands within the active project's designated workspace by default.
- If a request appears to concern a different repository or application, check whether the relevant project is actually available in the current workspace. Do not probe parent or sibling directories or assume authority over an unrelated project.
- If work in another repository is genuinely necessary, ask the user to identify or authorize the intended workspace before crossing that boundary.
- Avoid broad formatting, cleanup, or unrelated refactoring. Prefer the smallest coherent diff that solves the requested problem.
- Upstream (`dasilva333/airi`) MAY be inspected, fetched, and compared against for mergeability and upstream alignment (read-only reference operations: `git fetch upstream`, `git show upstream/<branch>:<path>`, `gh` API reads, `git diff upstream/main...HEAD` for review). Never push to, rebase onto, or merge from `upstream` without explicit current user authorization — those remain write/history operations, not reference reads.
- Remember that `crates/` contains the legacy Tauri application; the current desktop application is Electron in `apps/stage-tamagotchi`.

## 6. Git, Commits, and Releases

- Treat the `main` branch and published remote as release surfaces, since community users may consume published commits.
- Before a requested commit or push, inspect the full `git status` and review the complete intended diff. Separate pre-existing changes from task-related changes and preserve unrelated work.
- Validate the complete intended change before publishing. Never push known-untested changes or bypass required checks after a failure. If a meaningful TypeScript, Vue, or build-automation JavaScript change is involved, run the relevant workspace typecheck or build first.
- If validation fails, report the failure and its implications. Do not publish the affected change unless the issue has been resolved or the user explicitly requests a different, permissible local-only workflow.
- If the user requests a clean working tree, account for all pending paths, including unrelated work. Do not claim the tree is clean until the actual status supports that conclusion.
- Before handing off a tested but uncommitted checkpoint, summarize its state and leave the commit or push decision to the user.

### Destructive and Worktree-Changing Operations

- Avoid discarding work or changing branches when doing so could affect existing modifications.
- Before `git checkout`, `git switch`, or another worktree-changing operation, inspect the status. If the tree is dirty, review the affected changes and choose a safe path with the user.
- Never automatically create, restore, pop, or drop a Git stash. If the user authorizes stashing, report the stash identifier and track restoration explicitly.
- Commands such as `git reset --hard`, `git restore`, `git clean`, and equivalent destructive operations require explicit, current authorization for the particular operation. Do not interpret frustration or a general request to fix a problem as permission to discard work.
- Avoid secondary worktrees, temporary branches, index manipulation, and implicit autostashing as ways to bypass unresolved decisions about existing changes. Use alternative workflows when they are justified and authorized.

## 7. Implementation Conventions

- Follow the nearest established project pattern before introducing new abstractions.
- For service composition and typed IPC/RPC, prefer the established `injeca` and `@moeru/eventa` patterns documented in the Rosetta Stone.
- Prefer `@proj-airi/ui` components and Iconify icons over raw controls or bespoke SVGs where existing primitives fit the task.
- Prefer UnoCSS to Tailwind. For substantial UnoCSS class lists, use readable Vue class arrays rather than attribute-mode syntax. Reuse existing animations when practical.
- Avoid unnecessary backward-compatibility guards and shims. Introduce them when the supported compatibility requirements justify the additional complexity.
- Put translations in `packages/i18n`. Before finding or editing YAML settings keys, consult [`docs/settings-yaml.md`](./docs/settings-yaml.md) and follow its documented `scripts/yaml-manager.js` workflow.
- Prefer documented project tools over brute-force searches or manual edits. If a documented tool cannot answer the question or complete the task, use the smallest reasonable alternative.
- Write comments to explain non-obvious decisions, algorithms, workarounds, and platform-specific behavior rather than narrating the code. Use `// NOTICE:` for workarounds and include the cause and relevant reference where useful.

## 8. Stage-Mate and Unity Workspace Boundaries

- Treat `apps/stage-mate/mate-engine/` as a managed, gitignored upstream clone that should normally remain pristine. Its pinned upstream revision is `shinyflvre/Mate-Engine@2c5ea6b8f4cf5e1773a0816b46d9267cda5174d4` ("Prepare 3.4 Features").
- Make custom Stage-Mate changes in the version-controlled `apps/stage-mate/unity-src/` overlays:
  - `unity-src/Assets/` for custom assets and scripts, such as `StageMateBridge.cs` and `MateSidecar.cs`.
  - `unity-src/Patches/` for overrides of upstream `MATE ENGINE - Scripts/`.
  - `unity-src/ProjectSettings/` for project configuration.
- Use `pnpm -F @proj-airi/stage-mate run engine:setup` to synchronize the version-controlled overlays into `mate-engine/` when appropriate.
- If the managed clone needs resetting, first verify that the operation is necessary and that the target contains no valuable local work. The known clean-slate procedure is `git -C apps/stage-mate/mate-engine reset --hard 2c5ea6b8 && git -C apps/stage-mate/mate-engine clean -fd`. Because this is destructive, confirm that the target state is safe and obtain explicit authorization before executing it.

## 9. Proportional Validation

- Choose validation based on the change's risk, scope, and failure modes. Testing should establish useful confidence, not serve as a ritual.
- For text, label, or comment-only changes, review the diff; a script is usually unnecessary.
- For CSS or layout changes, inspect the affected surface and run additional checks if the change could affect compilation or behavior.
- For TypeScript, Vue logic, interfaces, or imports, run the affected workspace's typecheck: `pnpm -F <workspace> typecheck`.
- For build configuration, entry points, packaging, or Electron integration, run the affected workspace build. Remember that the `stage-tamagotchi` build includes typechecking, whereas `stage-web` does not.
- Use `pnpm lint:fix` deliberately because it can modify files broadly. Prefer non-mutating checks where available, and review any resulting diff.
- For meaningful changes to executable code, run the most relevant tests and consider coverage reporting using `pnpm -F <workspace> test --coverage` or the workspace's coverage script.
- Aim for near-complete coverage of changed executable lines, especially for critical logic and new branches. Prioritize meaningful assertions over a numerical target that would encourage brittle or redundant tests.
- If a relevant test is unavailable, prohibitively expensive, or unrelated to the actual change, explain the limitation and choose an appropriate alternative. Never claim validation that was not performed.

## 10. General Decision-Making Principles

- **Use the least restrictive approach that reliably protects the user's work and the project's integrity.**
- Prefer safe, reversible actions over irreversible ones. Escalate for confirmation when the consequences are significant, not merely because a procedure has several steps.
- Keep preparation, investigation, implementation, and validation proportional to the task.
- Follow explicit user intent unless it conflicts with a higher-priority instruction, a genuine safety concern, or an important repository constraint.
- Preserve the distinction between recommendations and authorization. A proposal is not approval to implement, and approval for one operation is not blanket permission for future operations.
- At handoff, provide a concise summary of what changed, what was verified, what remains uncertain, and any decisions the user still needs to make.
