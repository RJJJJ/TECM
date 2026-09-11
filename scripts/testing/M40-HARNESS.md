# M40 reliability and acceptance

Run the complete M40 acceptance entry from the repository root in the existing
local disposable Docker environment. The evidence root must be an existing
private directory outside the repository:

```powershell
$env:TECM_M40_EVIDENCE_ROOT = 'C:\private\m40-validation'
node scripts/testing/teacher-attendance-history-mutation-verify.mjs --m40-acceptance
```

Each invocation creates a separate attempt directory and new disposable
databases/containers. Do not share its fixtures with another database test.
For the stabilization phase, one complete PASS on the frozen candidate is the
acceptance requirement. Record the candidate identity, raw evidence and exclusions;
one PASS does not establish permanent freedom from flakes. The earlier two-pass
goal has been superseded. Full Teacher mutation and release validation remain
separate tasks.

## Acceptance boundaries and order

There is one formal entry: `--m40-acceptance`. Dedicated control flags remain
development tools and do not establish formal acceptance.

| Category | Responsibility | Effect on M40 |
| --- | --- | --- |
| A: M40 safety gate | Independent normal baseline; exact genuine/slow blocking mutation; RPC-local SQLSTATE/message/timing; same-lock witness; no side effects; unrelated SQL/forged output rejection; provenance, lifecycle and cleanup | Required, fails closed |
| B: Harness self-tests | Packet, collector, supervisor, construction, producer, classifier and diagnostic integrity counterexamples | Required where they protect A; no missing/duplicate/illegal-source failure is waived as diagnostic |
| C: repository workflow | Release YAML invocation guard and full workflow topology validator; unrelated business suites | Report separately; cannot make a failed M40 result pass and does not gate this entry |

Execution is cheap packet/supervisor/collector/construction checks, independent
Teacher and database baselines, slow and genuine positives, negative controls,
then verified cleanup/restoration. Cheap negative controls that consume baseline
fingerprints run in the negative phase. Every database probe cleans up before
the next starts; final success also requires source restoration.

The formal entry passes the explicit `-M40Acceptance` switch to the database
verifier. The default invocation still runs the full repository scope. The M40
scope keeps **all migration and seed setup**, SQL suites 001–008/017–019,
both existing/absent contention cases, retry assertions, negative preflight and
the original outer cleanup/terminal path. APNS business tests and unrelated
business races stay in the full repository scope. An APNS migration failure that
prevents creating the required schema is still a real prerequisite failure;
it cannot be converted into an accepted M40 run. Suites 003–007 are retained as
the existing fixture prerequisites for suite 008; for example, 007 creates the
future lesson required by its migrated-parent read assertion. They are not
silently replaced with weaker fixture assertions.

Normal baseline proof names its scope and requires the exact summary, both
contention proofs, retry proof, negative preflight, clean exit and cleanup. Its
diagnostic inventory is exact for that scope (182 expected notices versus 187
for the full repository baseline). Extra, missing or altered notices still reject;
the mutated run must match the independently produced contention prefix exactly.
The caught evaluator and SQL mutation are unchanged by this scope separation.

Not covered by an M40 PASS: the full Teacher mutation suite, SQL business suites
009–016/020, unrelated business races, the full repository database
verifier, the full release workflow validator, or merge/release approval. Previous
APNS/workflow failures remain historical failures, not newly passing results.

## Failure mechanism

PostgreSQL phase timestamps originate inside Docker; the PowerShell observer
uses the Windows clock. Comparing them as one clock caused a real slow-setup
packet to fail `M40_JOB_PACKET_TIME_INVALID` when SQL was 307 ms ahead of the
local observer. Later packets then failed the sequence check. Previously, the
first rejected packet was discarded and later receives replaced the original
error. A separate local reproduction also exposed fractional-millisecond
precision failures and acceptance of NaN timestamps.

The worker now preserves `sql_at_ms` separately from local `at_ms` and
`observed_at_ms`. Local timestamps establish local freshness and deadlines.
SQL timestamps establish ordering and duration within that SQL execution; they
are never compared to Windows time. Missing/reversed SQL times and invalid or
future local times still reject. This does not change PostgreSQL's three-second
statement timeout, its RPC location, the SQL 2500–5000 ms classification interval,
or the native/job 10/30-second limits.

The receiver retains the first error and a bounded representation of its first
rejected ingress record, counts subsequent rejections, and processes remaining
entries in a drained batch. It does not reorder or deduplicate packets to make
them pass. Packet identity, contiguous sequence, stream origin and size limits
remain mandatory. A complete worker result cannot conceal extra output, errors,
warnings, or unframed information records.

The historical failure lacked its first rejected packet, so its exact cause
cannot be proved retrospectively. The 307 ms mismatch is from a new, preserved
development failure on this task.

## Lock and result authority

The holder still acquires the same transaction advisory lock. While holding it,
the fixture observes a waiting competitor through `pg_locks` and
`pg_blocking_pids`, with matching lock identity, race/application name and wait
event. Its private temporary witness cannot be written by the competitor.
After release, a blocking SQL result without exactly one witness makes the
holder fail. This observation uses the existing holder process and bounded
barrier loop. It adds no separate supervisor or global observer.

The authority chain is unchanged: independent normal baseline, exact intended
mutation, RPC-local SQLSTATE/message/timing, data assertions, successful worker
and holder lifecycle, authenticated run correlation, semantic sidecar, outer
cleanup and terminal protocol. Progress/trace data alone cannot establish
`caught=true`. Normal nonblocking execution must still return the sanitized
P0001 quickly and satisfy the existing/absent attendance assertions.

## Retained coverage and entry changes

No existing safety control is removed or downgraded.

| Existing coverage | New acceptance entry |
| --- | --- |
| Normal Teacher tests and independent normal database baseline | Independent baseline stages; formal scope explicitly proves M40, full repository baseline remains in other entries |
| Negative preflight producer and diagnostic safety | Producer and diagnostic stages |
| All semantic, identity, freshness, duplicate, mixed-output and cleanup classifier cases | Classification stage, unchanged expected contracts |
| Lifecycle D genuine blocking; A/B/C failures | Genuine and lifecycle stages |
| Slow setup; timeout before RPC; R3 construction and trace tampering | Construction, slow and pre-RPC stages |
| R2 terminal errors and exact terminal success | Terminal stage; reuse this run's genuine result |
| Six real unrelated SQL / forged or mixed marker cases | SQL stage |
| Mutation target count and different mutation | Target-count and different-mutation stages |
| R3-F stdout/stderr provenance | Shared provenance helper, also used by the dedicated R3 entry |
| R4 H1–H8 and supervisory S1–S5 mechanisms | Collector, supervisory and explicit S5 stages |
| S2 release invocation fingerprint | Retained and reported separately from required local supervision/terminal checks; dedicated R4 entry still enforces it |
| New clock, first-error, batch retention and mixed worker envelope counterexamples | `m40-packet-controls.ps1`, no database |
| New valid-57014-without-witness and valid-57014-with-job-error counterexamples | Additional safety stages |

The older `--focused-acceptance` remains a legacy development entry. The formal
entry includes its M40 safety cases plus dedicated coverage it previously omitted,
orders checks by the sequence above, and preserves stage results before continuing.
Its scoped result must not be described as a full repository verifier or a run of
the old entry. No safety counterexample is deleted or assigned a new expected
outcome because of a failure.

## Evidence and replay

The F1–F3 review corrections reject duplicate decoded JSON keys at every object
level before parsing the terminal or semantic sidecar (maximum nesting 32).
Conflicting values are never resolved by choosing the first or last value.
The fixed NOTICE inventory records every source, SQL line, severity, message and
occurrence count for 182 scoped / 187 repository notices. It was checked against
the SQL statements and preserved legitimate baseline outputs; current output
cannot extend it. Only a complete validated normal run supplies the mutation
prefix fingerprint. Repository-mode fixture checks are not a repository runtime
PASS. SQL phase names bind competitor/stderr/SQL-time requirements; verifier
phases bind verifier/none/local time. Neither clock is compared to the other.

The existing classifier controls include direct and escaped duplicate keys in
terminal and nested sidecar objects. Diagnostic controls cover exact NOTICE
content, line, severity, missing/extra and duplicate substitution, plus bounded
JSON syntax/depth and legal repeated keys in separate objects. Trace tampering
includes RPC source relabeling with missing SQL timestamps and stream relabeling.
The existing controls and timeout limits remain in place.

Each attempt records candidate hashes, probe commands and source hashes,
original parent-received stdout/stderr byte buffers, exit status, sidecars,
classification inputs/decisions, stage results and cleanup. Worker result JSON
and rejected-ingress JSON are explicitly deserialized evidence, not original
OS pipe bytes. Missing artifacts are recorded as missing; they must not be
reconstructed and labelled original.

Teacher baseline now saves its original parent-received stdout/stderr byte
buffers, command/start and exit metadata; its stage result is no longer null.
`job-rejection-evidence.json` retains a bounded first deserialized ErrorRecord
and first rejected ingress (if present), including in nontrace sidecar mode.
These are PowerShell representations, not original OS pipe bytes. The original
artifact mtime is also recorded in preservation metadata. Evidence-write failure
cannot skip cleanup or turn the tested failure into a success.

Raw per-probe capture supersedes the older duplicate decoded parent-text
capture. This removes a redundant preservation path while retaining a stronger
original-byte record for both normal and mutated runs. The strict classifiers
continue to inspect the actual run output and sidecars.

The unused `Read-M40CompetitorTrace` fallback parser was removed. Its diagnostic
provenance responsibility is handled by the active incremental receiver and
shared trace validator; R3-F and trace tamper controls cover that responsibility.
No callable entry depended on the removed parser.

Useful development commands:

```powershell
pwsh -NoProfile -File scripts/testing/m40-packet-controls.ps1
node scripts/testing/teacher-attendance-history-mutation-verify.mjs --r4-controls
node scripts/testing/teacher-attendance-history-mutation-verify.mjs --m40-safety-controls
```

`--r4-real-diagnostic` deliberately has no normal baseline and cannot establish
formal acceptance. Preserve its result as diagnostic evidence only.

References: [PostgreSQL lock identity and blocking backends](https://www.postgresql.org/docs/15/view-pg-locks.html),
[PostgreSQL activity snapshots](https://www.postgresql.org/docs/15/monitoring-stats.html),
[PowerShell consuming stream collections](https://learn.microsoft.com/en-us/dotnet/api/system.management.automation.psdatacollection-1?view=powershellsdk-7.6.0).
