# Proof of Intent: Project Document

**Status:** v2, Oct 30, 2026. This is the arbiter: when a spec, an issue and this document disagree, fix the
spec or the issue to match this, or change this in a PR that everyone reviews.
Technical detail lives in the [specs](specs/); this document keeps the why, the scope and the plan.

**Deadline:** Nov 12, 2026, 12:00 pm Pacific (Nov 13, 1:30 am IST). **Team target:** submitted Nov 11.

## 1. Problem and product

Shopping agents now place orders inside ChatGPT, Copilot, Perplexity and Meta's Muse. When an agent misreads
an instruction, buys the wrong item or overspends, the buyer disputes the charge and the merchant, as merchant
of record, carries the loss. Chargeback tooling was built for a human clicking a button, so merchants have no
record of what the agent was authorized to do.

Proof of Intent answers one question at two moments: **did the agent do what the user actually asked?**
Before capture, by checking the cart against a signed Intent Mandate. When a dispute arrives, by turning that
mandate into evidence, or into a fair refund.

**Who it serves.** Primary: small and mid-size PayPal merchants starting to receive agent orders. Secondary:
developers of buyer agents who need a merchant endpoint that accepts mandates; dispute analysts.

**Who sends the mandates?** We accept the AP2 mandate format, so any agent that speaks AP2 works with no custom
integration. Orders without a mandate take the standard `NO_MANDATE` path, so installing Proof of Intent never
makes a merchant worse off.

**Positioning.** PayPal-native, preventive, standards-aligned: the mandate model PayPal itself described for AP2,
on PayPal rails, for the dispute types Seller Protection does not cover.

## 2. Hackathon fit

Stage One is pass/fail (theme fit, use of the required APIs). Stage Two scores five equally weighted criteria;
ties go to **Technological Implementation** first.

| Criterion | How we score |
|---|---|
| Technological implementation | Orders v2, Vault v3, Webhooks, Disputes API, Agent Toolkit; signed mandates; deterministic policy engine; downgrade-only LLM |
| Design | A complete merchant product: checkout endpoint, verification queue, dispute workspace, dashboard |
| Potential impact | A dispute class PayPal's own protection leaves open, cited industry data, adoption through AP2 |
| Innovation | Prevention before capture and fair concession after, not another evidence bot |
| Presentation | One contrast demo in 2:30: a defended compliant order and a refunded overreaching order |

**Prizes.** Primary: Best Use of Agentic Commerce ($5,000). Reach: a Grand Prize. Sponsor: Best Use of AG Grid,
1st place ($5,000). A project can win one Grand *or* one Honorable Mention prize, plus one Sponsor prize.

**Team rules from the Official Rules.** All four members register on Devpost and join the project through the
invite link; one **Representative** submits for the team and receives any prize, which the team splits as agreed
in advance. Winners complete an affidavit; members outside the US may need a W-8BEN.

**What we claim and do not claim.** We claim a working, PayPal-native implementation of mandate-verified agent
checkout and mandate-backed dispute handling. We do not claim to be first, and we do not claim PayPal's
production systems read our mandates. The video says so.

## 3. Research grounding

- Visa: disputes in agentic payments lack established resolution mechanisms; evidence rules assume human-speed commerce. [Report](https://www.visa.com/vcom-assets/content/dam/visa/reimagine-visa/thought-leadership/documents/agentic-payments-report.pdf)
- Finextra predicts "hallucination disputes" where the merchant of record is held liable. [Article](https://www.finextra.com/blogposting/31251/deep-dive-the-hidden-liability-of-agentic-commerce)
- PayPal Agentic Commerce Pulse: nearly two-thirds of merchants want a standard liability framework urgently. [Report](https://pep.paypal.com/us/brc/article/agentic-commerce-pulse-report-findings)
- Chargebacks911: ~23.5% of merchants use five or more tools to compile evidence. [Coverage](https://www.sdcexec.com/sourcing-procurement/financial-management-software/news/22969794/chargebacks911-friendly-fraud-impacts-83-of-enterprise-merchants)
- Google AP2 models every agent purchase as signed Intent, Cart and Payment mandates. [AP2](https://ap2-protocol.org/) · [A2A extension](https://ap2-protocol.org/a2a-extension)
- Mastercard Verifiable Intent (March 2026) defines eight constraint types. [Coverage](https://www.pymnts.com/mastercard/2026/mastercard-unveils-open-standard-to-verify-ai-agent-transactions/)
- ACI: only merchants with the authorizing mandate and agent identity can defend agent chargebacks. [ACI](https://www.aciworldwide.com/agentic-payments)
- American Express (April 2026) refunds wrong-item purchases by registered agents sending authenticated intent. [Analysis](https://natepegram.com/agentic-commerce/payments)
- PayPal's AP2 blog proposes Cart and Intent Mandates in Seller Protection workflows. [Blog](https://developer.paypal.com/community/blog/PayPal-Agent-Payments-Protocol)
- PayPal Agent Ready covers unauthorized and item-not-received claims only; wrong-item and misread intent are open. [Agent Ready](https://www.paypal.ai/agent-ready)
- Juniper Research: transactions without Google or Mastercard can leave the merchant with no source of truth. [The Paypers](https://thepaypers.com/payments/expert-views/disputes-and-friendly-fraud-in-the-age-of-agentic-commerce)

| Player | What they do | Gap |
|---|---|---|
| Chargebacks911 (Oct 27, 2026) | Indemnifies agent-purchase chargebacks | After the fact, insurance, no mandate at checkout |
| Chargeflow, Justt, Disputifier | Automated evidence, success-fee pricing | After the fact, incentive to fight rather than concede |
| Forter, Riskified | Agent identity and fraud at checkout | "Is this agent legitimate", not "did it follow the user" |
| Nekuda, Skyfire | Buyer-side mandates and agent identity | No merchant dispute workflow |
| PayPal Agent Ready | Seller Protection on eligible agent transactions | Unauthorized and item-not-received only |

No product found combines mandate capture at checkout, cart-versus-intent verification before capture, and
mandate-backed evidence in the PayPal Disputes API.

## 4. Scope

The MVP is the full loop for one merchant: mandate in, verified capture out, dispute classified and answered.
Stretch work starts only after the loop passes end to end on the sandbox **twice in a row**.

| # | Feature | Spec | Owner |
|---|---|---|---|
| F1 | Intent Mandate creation and browser signature | 0001 | Sristee |
| F2 | Cart Mandate issued only after hard rules pass | 0001, 0003 | Sristee |
| F3 | Deterministic policy engine | 0002 | Sristee |
| F4 | LLM semantic check (downgrade only) | 0006 | Sumedha |
| F5 | PayPal order with mandate pointer in `custom_id`; authorize, capture or void | 0004 | Harsh |
| F6 | Agent-alone checkout via vaulted PayPal wallet | 0004 | Harsh + Sristee |
| F7 | Step-up approval; no order until the shopper approves | 0003 | Sristee |
| F8 | Webhook receiver with signature verification | 0004 | Harsh |
| F9 | Dispute classification into four classes | 0005, 0006 | Sikruti + Sumedha |
| F10 | Evidence package (PDF attestation + JSON bundle) | 0005 | Sikruti |
| F11 | Dispute actions gated by an operator click | 0005 | Sikruti + Harsh |
| F12 | AG Studio dashboard with custom widgets and theme | 0007 | Sikruti |
| F13 | Studio agent harness (DisputeExplainer) | 0007 | Sumedha |
| F14 | Seed data and demo mode | 0009 | Sumedha |
| F15 | Public repo, Compose, hosted demo on the team server | 0008 | Harsh |

**Stretch:** agent registry with attestations; make-offer for partial fits; multi-merchant tenancy; PayPal MCP
server as a read-only operator tool; Verifiable Intent vocabulary mapped onto the policy engine.

**Non-goals:** no AP2 or Verifiable Intent certification; no fraud scoring or bot detection; no card processing
outside PayPal; no native mobile app; no production-grade observability or load engineering.

## 5. User journeys

**A. Human-present purchase.** The shopper says "grey running jacket under $80, ship home"; the app builds and
the shopper signs an Intent Mandate. The agent picks an item; the merchant runs hard rules and the semantic check
*before* signing the Cart Mandate. The shopper approves with the PayPal button; the order is created with
`intent: AUTHORIZE`; a pre-capture re-check (cart hash, expiry, nonce) passes; capture.

**B. Agent alone, including the rejection.** The shopper vaulted a PayPal wallet once. Later the agent proposes a
**red jacket at $95**: hard rules fail (`AMOUNT_EXCEEDS_MAX`, `ATTRIBUTE_MISMATCH`), no Cart Mandate, no PayPal
order, reason codes back to the agent. The agent retries with a grey jacket at $74; APPROVE; create and capture
against the vault id. If only the semantic check is unsure, the shopper gets a step-up link and nothing is charged.

**C. Dispute on a compliant order (defend).** The shopper files "item not as described". The copilot finds the
mandate bundle, classifies `MANDATE_COMPLIANT`, drafts the evidence package; the operator reviews and submits.

**D. Dispute on an overreaching order (concede).** A seeded "before installing Proof of Intent" order shows a red
$95 jacket captured against a grey-under-$80 mandate. The copilot classifies `AGENT_OVERREACH`, shows the mandate
diff, recommends accepting; the operator accepts.

The 2:30 video script is in [DEMO.md](DEMO.md).

## 6. Team

| Person | GitHub | Owns | Backup |
|---|---|---|---|
| Harsh Kumar Singh | @harshkumarsingh12 | PayPal client, API, DB, team server, CI/CD | Sristee |
| Sristee Shrivastava | @srshriv | Contracts, mandate crypto, policy engine, buyer app + agent, security | Harsh |
| Sikruti Mahapatra | @hoursgotviral-dev | Dispute copilot worker, AG Studio dashboard | Harsh (dashboard, after Nov 6) |
| Sumedha | @sumedhag28 | AI jobs, evals, replay mode, Studio agent, demo, video, Devpost | Sikruti |

Path-level ownership: [CONTRIBUTING.md](../CONTRIBUTING.md#who-owns-what). Representative for Devpost: **to be named
at the Oct 31 standup** (issue in M0).

## 7. Plan and gates

Gates are the only points where everyone depends on everyone. A missed gate triggers its cut list, not a slip.
Day-by-day tasks are GitHub issues under each milestone; see [ROADMAP.md](ROADMAP.md).

| Gate | Date | Pass condition | If missed |
|---|---|---|---|
| M0 Contracts signed + server up | Oct 31 | Specs 0001–0009 Accepted; fixtures committed; server serves `/healthz` over public HTTPS | Build on drafts; Cloudflare Tunnel fallback |
| M1 Slice on sandbox | Nov 3 | Signed mandate verified; sandbox order authorized and captured with the pointer in `custom_id`; dashboard shows it | Drop Vault (F6); human-present only |
| M2 Dispute cycle | Nov 6 | Real `CUSTOMER.DISPUTE.CREATED` classified; evidence submitted and a claim accepted in sandbox via the UI | Drop make-offer and the Studio harness |
| M3 Feature freeze | Nov 8 | Journeys A–D pass on sandbox twice in a row | Cut F13, then F7; never F9–F11 |
| M4 Submission | Nov 11 | Video public, repo public, README verified on a clean machine, hosted demo live and monitored | Submit with mock + replay instructions |

## 8. Risks

| # | Risk | L | I | Owner | Mitigation |
|---|---|---|---|---|---|
| R1 | Sandbox dispute flow differs from docs, or Disputes not enabled | M | H | Harsh | Spike by Nov 4; PayPal Discord; mock mode keeps others moving |
| R2 | Vault v3 needs permissions the sandbox app lacks | M | M | Harsh | Spike Nov 1; drop F6 at the Nov 3 gate |
| R3 | Team server down during judging (to Dec 15) | M | H | Harsh | Restart policies, uptime alerts, nightly backups, local fallback |
| R4 | Webhooks can't reach the server (TLS, DNS, NAT) | M | H | Harsh | HTTPS by Oct 31; Cloudflare Tunnel fallback |
| R5 | LLM verdicts differ between video takes | M | M | Sumedha | Temperature 0, strict schemas, replay mode for recording |
| R6 | AG Studio license expires before Dec 15 or watermarks | M | M | Sikruti | Renewal key Nov 25; plain AG Grid fallback page |
| R7 | Scope creep before the gates | H | H | all | Cut lists; no stretch merges before Nov 8 |
| R8 | Judges can't run it | M | H | Sumedha | Three access paths; zero-credential defaults; clean-machine test Nov 10 |
| R9 | Over-claiming in the pitch | M | H | Sumedha | Claims list above; honesty line in the video |
| R10 | Video over 3:00 or unclear | M | H | Sumedha | Script timed at 2:30; dry runs Nov 9–10 |
| R11 | Public demo abused (AI spend, junk data) | M | M | Harsh | Rate limits, budget kill switch, viewer role, nightly reset |
| R12 | Secrets committed | L | H | Harsh | gitleaks, gitignore, server secrets outside the checkout |
| R13 | A teammate is out for a day | M | M | all | Backups per area; package READMEs; contracts let others merge |

## 9. Open decisions

| # | Decision | Default | By | Owner |
|---|---|---|---|---|
| D1 | LLM provider and model | Chosen in spec 0006 | Oct 31 | Sumedha |
| D2 | Vault v3 in MVP | Yes; drop at the Nov 3 gate if the spike fails | Nov 3 | Harsh |
| D3 | Step-up channel | Email link with a signed token | Oct 31 | Sristee |
| D4 | Studio agent calls the PayPal MCP server | No for MVP; Toolkit read-only tools only | Nov 7 | Sumedha |
| D5 | Hosting | **Decided:** team server, Docker Compose | done | Harsh |
| D6 | Public HTTPS method | Caddy + Let's Encrypt if public IP; else Cloudflare Tunnel | Oct 31 | Harsh |
| D7 | Domain and subdomains | `api.`, `shop.`, `ops.` on a team domain | Oct 31 | Harsh |
| D8 | Prize split among the four | Agree in writing before submission | Nov 10 | everyone |

## 10. Sources

[Official Rules](https://paypalaihackathon.devpost.com/rules) · [Overview](https://paypalaihackathon.devpost.com/) ·
[Resources](https://paypalaihackathon.devpost.com/resources) · [AG Grid sponsor page](https://paypalaihackathon.devpost.com/details/aggrid) ·
[AG Studio custom widgets](https://www.ag-grid.com/studio/react/custom-widgets/) · [AG Studio 3](https://www.ag-grid.com/blog/ag-studio-3-is-here-dashboards-for-humans-and-ai/) ·
[Disputes API](https://developer.paypal.com/api/customer-disputes/v1) · [provide-evidence](https://docs.paypal.ai/reference/api/rest/disputes-actions/provide-evidence.md) ·
[Dispute reasons](https://docs.paypal.ai/growth/disputes/reference/dispute-reasons) · [Agent Toolkit](https://github.com/paypal/agent-toolkit/) ·
[MCP quickstart](https://docs.paypal.ai/developer/tools/ai/mcp-quickstart.md) · [Seller Protection in the agentic era](https://www.paypal.com/us/brc/article/seller-protection-agentic-commerce) ·
[Chargebacks911 indemnification](https://www.finopotamus.com/post/chargebacks911-launches-first-of-its-kind-ai-agent-purchase-indemnification-for-merchants-1) ·
[Chargeflow playbook](https://www.chargeflow.io/blog/agentic-commerce-chargebacks-the-evidence-playbook-merchants-need) ·
[Forter](https://www.prnewswire.com/news-releases/forter-turns-the-ai-shopping-agent-surge-into-a-secure-revenue-channel-for-merchants-302906333.html) ·
[Riskified](https://www.riskified.com/press/agentic-commerce-pulse-consumer-survey-november-2026/) · [Stripe Agentic Commerce Suite](https://stripe.com/blog/agentic-commerce-suite)
