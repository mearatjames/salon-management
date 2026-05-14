# Feature Specification: Project Scaffolding

**Feature Branch**: `001-project-scaffolding`

**Created**: 2026-05-13

**Status**: Draft

**Input**: User description: "Look at the system design doc and start our spec for project scaffolding. This first should be just focusing on getting the project structure setup. npm packages installed etc.. Make sure to follow standard best practices when scaffolding."

## User Scenarios & Testing *(mandatory)*

This feature is developer-facing. The "users" are the engineers who will build Tang Nails. The
goal is a clean, conventional, ready-to-build foundation: a developer can clone the repository,
install dependencies, and start working on real features immediately, with all quality gates and
project conventions already in place.

### User Story 1 - Clone, install, and run the app (Priority: P1)

A developer with no prior setup clones the repository, runs a single documented install command,
starts the development server, and sees the application boot to a placeholder landing page in the
browser.

**Why this priority**: Nothing else can be built until the project runs locally. This is the
minimum viable scaffold — it proves the toolchain, dependency set, and build pipeline are coherent.

**Independent Test**: On a clean machine, follow the documented setup steps. Success is the dev
server starting without errors and the placeholder page rendering in a browser.

**Acceptance Scenarios**:

1. **Given** a fresh clone with no installed dependencies, **When** the developer runs the
   documented install command, **Then** all dependencies install without errors.
2. **Given** dependencies are installed, **When** the developer runs the documented dev command,
   **Then** the development server starts and a placeholder landing page is reachable in a browser.
3. **Given** dependencies are installed, **When** the developer runs the documented production
   build command, **Then** the build completes successfully with no errors.
4. **Given** the developer's tool versions do not meet the project's stated requirements,
   **When** they run the install or dev command, **Then** they receive a clear message naming the
   expected versions.

---

### User Story 2 - Run the quality gates (Priority: P2)

A developer runs the project's quality-gate commands — linting, formatting check, type checking,
unit tests, and end-to-end tests — and every one of them executes and passes against the untouched
scaffold.

**Why this priority**: The constitution requires every PR to pass type checking, the unit suite,
and the end-to-end suite. The harness for all of these must exist and be green from day one, or
test-first development cannot start.

**Independent Test**: On a fresh install, run each quality-gate command in turn. Success is every
command running to completion and reporting a passing result.

**Acceptance Scenarios**:

1. **Given** a fresh install, **When** the developer runs the lint command, **Then** it completes
   with no errors.
2. **Given** a fresh install, **When** the developer runs the type-check command, **Then** it
   completes with no type errors.
3. **Given** a fresh install, **When** the developer runs the formatting check, **Then** it reports
   the codebase as already correctly formatted.
4. **Given** a fresh install, **When** the developer runs the unit-test command, **Then** the test
   runner starts, executes a sample placeholder test, and reports success.
5. **Given** a fresh install, **When** the developer runs the end-to-end test command, **Then** the
   end-to-end runner starts, executes a sample placeholder test against the running app, and reports
   success.
6. **Given** a change is pushed to the repository, **When** continuous integration runs, **Then**
   it executes the same quality gates and reports their combined result on the change.

---

### User Story 3 - Find your way around the project (Priority: P3)

A developer opening the repository for the first time finds a directory skeleton that matches the
structure described in the system design document, plus the conventional project files (ignore
rules, environment variable template, editor settings, contributor-facing readme) that tell them
where things go and how to work.

**Why this priority**: A predictable structure and documented conventions reduce friction on every
later feature. It is valuable but not blocking — features could be built into a less tidy tree —
so it ranks below a running app and working gates.

**Independent Test**: Compare the scaffolded directory tree against the repo layout in the system
design document, and confirm the conventional project files are present and accurate.

**Acceptance Scenarios**:

1. **Given** the scaffolded repository, **When** a developer inspects the directory tree, **Then**
   every top-level directory in the system design document's repo layout exists.
2. **Given** the scaffolded repository, **When** a developer looks for the list of required
   environment variables, **Then** an environment variable template file documents every variable
   the application expects, with no real secrets committed.
3. **Given** the scaffolded repository, **When** a developer opens it in an editor, **Then** shared
   editor and formatting settings are applied automatically.
4. **Given** the scaffolded repository, **When** a new contributor reads the contributor-facing
   readme, **Then** they can identify the setup steps, the available commands, and where each kind
   of file belongs.

---

### Edge Cases

- A developer on an unsupported runtime version attempts to install or run the project — the
  project surfaces the expected version rather than failing obscurely.
- A developer starts the dev server without creating their local environment file from the
  template — the app starts in a degraded but non-crashing state, or fails with a clear message
  naming the missing variables.
- A developer runs a quality-gate command before installing dependencies — the failure clearly
  indicates that dependencies are missing.
- The dependency lockfile is out of sync with the manifest — the install step surfaces the
  mismatch rather than silently resolving different versions.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The repository MUST include a dependency manifest and a committed lockfile that
  together install a consistent, reproducible set of dependencies for every developer.
- **FR-002**: The dependency set MUST cover the technology stack named in the system design
  document (the web application framework, the styling system, the component primitives and icon
  set, the data/backend client, the payment provider client, the client-side data-fetching and UI
  state libraries, and the unit and end-to-end test runners).
- **FR-003**: The project MUST expose documented commands for: starting the development server,
  producing a production build, running the production build, linting, checking formatting, type
  checking, running unit tests, and running end-to-end tests.
- **FR-004**: Running the development server on a fresh install MUST serve a placeholder landing
  page without errors.
- **FR-005**: Running the production build on a fresh install MUST complete successfully.
- **FR-006**: Type checking MUST be configured in strict mode and MUST pass on the untouched
  scaffold.
- **FR-007**: Linting and formatting MUST be configured with a single agreed rule set, and the
  untouched scaffold MUST already satisfy both.
- **FR-008**: A unit test runner MUST be configured with at least one passing sample test, so the
  test-first workflow can begin immediately.
- **FR-009**: An end-to-end test runner MUST be configured with at least one passing sample test
  that exercises the running placeholder app.
- **FR-010**: The directory skeleton MUST match the repository layout described in the system
  design document, so later features have a known home.
- **FR-011**: The repository MUST include an ignore-rules file that excludes dependencies, build
  output, local environment files, and other non-source artifacts from version control.
- **FR-012**: The repository MUST include an environment variable template that names every
  variable the application expects, with placeholder (non-secret) values and brief descriptions.
- **FR-013**: The repository MUST declare the supported runtime version(s) so developers and
  continuous integration use a consistent environment.
- **FR-014**: The repository MUST include shared editor/formatting configuration so all
  contributors produce consistently styled files.
- **FR-015**: A continuous integration workflow MUST run the quality gates (lint, formatting
  check, type check, unit tests, end-to-end tests, build) on every change pushed to the repository.
- **FR-016**: The repository MUST include a contributor-facing readme covering setup steps,
  available commands, and the project structure.
- **FR-017**: The styling system MUST be wired so that a later feature can drop in the Lacquer
  design tokens and have them apply globally, without rework to the scaffold.
- **FR-018**: The scaffold MUST be configured so the design-system component workflow described in
  the system design document (adding shared UI primitives) functions without further setup.
- **FR-019**: The scaffold MUST NOT include real application features (calendar, clients,
  checkout, walk-in, end-of-day, authentication, payment integration, database schema); it
  contains only placeholders and the structure those features will later fill.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can go from a fresh clone to a running development server in under 5
  minutes by following the documented steps.
- **SC-002**: All eight documented commands (dev, build, start, lint, format check, type check,
  unit test, end-to-end test) run to completion and report success on the untouched scaffold.
- **SC-003**: 100% of the top-level directories in the system design document's repo layout exist
  in the scaffolded repository.
- **SC-004**: Continuous integration runs all quality gates on a pushed change and reports a
  combined pass/fail result with no manual steps.
- **SC-005**: A new contributor can correctly identify where at least 9 of 10 sample file types
  belong, using only the readme and directory structure.
- **SC-006**: Re-running the install command on a second machine produces an identical dependency
  tree (verified by an unchanged lockfile).

## Assumptions

- **Package manager**: npm is the package manager, per the user's request ("npm packages
  installed").
- **Runtime**: The project targets a current Node.js LTS release; the exact version is pinned
  during planning.
- **Design tokens deferred**: Vendoring the Lacquer design tokens into the styling layer (copying
  `colors_and_type.css` into `styles/tokens.css`) and building actual components are handled by a
  later styling-foundation feature. This feature creates the `styles/` and component directories
  and wires the styling system, but does not populate token values or build components.
- **No live services**: Provisioning Supabase projects, Square credentials, and real environment
  values is out of scope. The environment template documents the variables; no services are
  connected and no secrets are committed.
- **Placeholder app only**: The scaffold renders a single placeholder landing page. Real surfaces
  and the database schema arrive in their own features, in the build order given by the system
  design document.
- **Continuous integration host**: CI runs on the repository's existing git host using its native
  workflow mechanism.
- **Scope guard**: Per constitution Principle V, this feature stays strictly within scaffolding —
  no deferred v1 items and no speculative structure beyond the documented repo layout.
