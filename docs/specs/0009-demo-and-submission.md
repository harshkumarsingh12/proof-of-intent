# 0009: Demo and submission

| | |
|---|---|
| **Status** | Proposed |
| **Owner** | @sumedhag28 |
| **Reviewers** | everyone |
| **Milestone** | M0 (registration), M3 (seed data), M4 (video, submission) |
| **Code** | `docs/DEMO.md`, seed scripts in `packages/db` |

## Context

Judges may score from the video and text alone. Presentation is one of five equal criteria, and Stage One
(pass/fail) checks theme fit and API use from what we submit.

## Design

**Requirements from the Official Rules (section 4):**
- Text description: features, PayPal APIs used and how, AI tools used and how, the "who sends the mandates" line.
- Functional demo: hosted URLs plus complete setup instructions. A mockup does not qualify.
- Public repo with all source and an open-source license visible in the About section.
- Testing access: demo logins, judge sandbox accounts, zero-credential local run (Devpost testing instructions).
- Video under three minutes, project working on its platform, public on YouTube, no third-party trademarks or
  copyrighted music.
- All in English. Submitted before Nov 12, 12:00 pm PT; team target Nov 11.
- Team: all four registered and on the project; one Representative submits; prize split agreed in writing.

**Seed data:** 300 synthetic agent orders across four platforms, 24 disputes, and the two scripted disputes
(compliant + overreach) pinned on top. Fictional names and addresses only.

**Video:** script and production rules in [DEMO.md](../DEMO.md). Recorded in replay mode against the sandbox.

## Acceptance criteria

1. Four members on the Devpost project; Representative named in docs/PROJECT.md. *(M0)*
2. Seed command produces the dataset and the two scripted disputes. *(M3)*
3. Video ≤ 2:45 on the timer at both dry runs. *(M4)*
4. A teammate who didn't write SETUP.md runs the stack from it on a clean machine. *(M4)*
5. Submission saved on Devpost by Nov 11 evening IST. *(M4)*
