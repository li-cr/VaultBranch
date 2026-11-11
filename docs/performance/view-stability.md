# Avoid intermediate pages during asynchronous view updates

Baseline: published 0.2.33, commit `82cb7c2`. Candidate: local working-tree changes based on that commit; not published. Runtime Git reads and save checks are unchanged. This addresses visible intermediate states, not the 50-ms content-ready target.

## Findings and changes

- File history destroyed its MergeView and replaced the description/path with a loading message before comparisonVersions completed. It also cleared the entire page before fetching the history list. Read the list and initial comparison first; switch selected commit, description/path, navigation and editor together. During a detail read keep the complete previous detail inert/busy. Preserve list scroll during full refresh and reject obsolete/closed requests.
- Git Graph cleared detail files before awaiting commitFiles/stashFiles. Its graph list also appended each 100-row batch to the live page and yielded, exposing a partially built list and delaying scroll restoration. Build batches in a detached container; include the selected detail before mounting the completed page, then restore scroll immediately. Detail selections update heading/actions/files together. Keep request guards valid after a cached unchanged-data render and invalidate detail requests on close.
- The conflict view cleared result and source controls before reading conflict versions. Build the replacement away from the page, commit once complete, and restore body scroll. Existing explicit preserveDraft behavior and expected-content checks remain. Capture the displayed path for its save action; no save/stage behavior is relaxed.
- The sidebar's full render snapshot included busy/error/branch counts, so those changes replaced all tree nodes even with identical files. Give the tree a separate structural snapshot and update Git action disabled states in place. File additions/deletions/state transitions, folder collapse and language changes still rebuild the tree. File selection behavior is unchanged.

Existing editable/staged diff pages already prepare comparison data before replacing the displayed page, so their read/verification path was left intact. Settings tab changes and folder expansion are intentional layout changes; asynchronous settings-tracking explanatory text was not redesigned. No animations, arbitrary presentation delays, new index caches, dependencies, Git queries or persistent processes are added.

## Reproduction

Use a disposable Obsidian vault named note_test. Install baseline assets, run tests/manual/view-stability-ui.js via the developer console/CDP, and collect its returned object. Run `node scripts/check-history-stability.cjs <CDP-port>` for the real input collection. Repeat after building/installing the candidate. Run tests sequentially; pause other Git plugins during ordinary save/stage fixture regressions and restore them afterward.

Windows 10 build 19045, Obsidian 1.15.0, Electron 43.8.4, embedded Node 24.22.1, Git 2.50.0.windows.1. Same test window, fixtures and driver on both builds. No physical-paint or wall-clock speed claim is made. Gate elapsed times include deliberate waiting and must not be used as latency results.

The gated fixture has small Markdown, large JSON, small JSON and large Markdown under nested directories with duplicate basenames. It uses real Git history and a real conflict in an isolated temporary repository. File history and graph detail reads are gated five times each; conflict refresh is gated five times with a distinct manual resolution. MutationObserver checks a synthetic 250-row graph formed by repeating real commit metadata to exercise the batch boundaries. Additional checks cover complete refresh, index preservation, failure/recovery, cached render callbacks, and close-during-read cleanup.

The trusted CDP driver creates four real commits whose deeply nested JSON file alternates small/large contents, clicks commit rows 12 times and verifies isTrusted, completed selection and matching comparison. MutationObserver and polling detect loading placeholders and title changes while the prior editor is still displayed. This detects the reported intermediate-page behavior, not every possible layout change or monitor paint.

## Results

| Scenario and scale | Metric | Before | After | Samples/method |
| --- | --- | --- | --- | --- |
| Alternate small/large JSON history | Clicks exposing loading/mismatched detail | 12/12 | 0/12 | Real trusted CDP mouse clicks, same driver |
| File history detail reads | Intermediate detail replacements | 5/5 | 0/5 | Gated real reads plus frame/DOM inspection |
| Graph commit file reads | Heading-only intermediate detail | 5/5 | 0/5 | Gated real reads plus frame/DOM inspection |
| Conflict refresh with manual resolution | Prior result removed before read completes | 5/5 | 0/5 | Gated real conflict reads |
| Graph list, synthetic 250 rows | Partial new list exposed between batches | Yes | No | MutationObserver, two batch boundaries |
| Busy-only sidebar changes | Existing tree node replaced | Yes | No | DOM identity assertion |

The initial 31-check baseline had 18 failures for these intermediate-state/node-replacement cases. All 36 candidate stability checks passed, including five extra error/cached-refresh/close checks without a baseline count. The raw collection is [view-stability-samples.json](view-stability-samples.json); it contains generated test data and gate timings only. Do not interpret gate timing differences as speed improvements.

104 local automated tests pass. Existing Obsidian UI regressions pass: 25 file-history checks (rename, pagination, branches, readonly, folding and cleanup), 21 sidebar selection/action/draft checks, and 41 editable diff loading checks including mixed/nested sizes, near/over-2-MiB fallback, draft/undo/save protection and unchanged index. These tests preserve the existing diff post-render verification. Runtime errors, retained edit sessions and drafts were empty after cleanup.

New pages still have to wait for Git; they may remain blank before their first complete result. Completed pages are inert while being replaced so old actions cannot operate under a new requested state. The changes do not eliminate required reading time or promise zero movement when different content naturally has different dimensions. Linux/macOS UI, peak memory and real-vault timing were not measured.
