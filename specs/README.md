# Specification as Code

`specs/tasks/*.yaml` is the source of truth for behavior-changing work before implementation begins.

Each feature, bug fix, refactor, security change, or maintenance change that can alter behavior must have an approved task specification. The specification records the objective, verifiable requirements, edge cases, security invariants, compatibility constraints, non-functional requirements, out-of-scope items, acceptance criteria, and regression-test obligations.

Run `npm run check:specs` before implementation and as part of CI. Requirement IDs must be unique across active task specifications. Every verification path must exist. Bug specifications must declare `regression.required: true` and at least one regression test.

The schema contract is `specs/schema.json`. Task specifications use YAML for readability, but validation is performed by the repository checker rather than by agent judgment alone.
