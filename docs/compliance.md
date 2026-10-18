# European models, compliance templates and reference cloud prices

Three options for projects that must respect European rules: debates played by European models only, compliance
templates whose requirements the arbiter checks option by option, and current reference prices for the running costs.

## European models only

A session can require that every role (interviewer, proposers, critics, devil's advocate, arbiter) is played by a
European model. The list of what counts lives in one place, `packages/core/src/sovereignty.ts`, with the reason for
each entry:

| Source | Why it counts |
| --- | --- |
| Mistral AI models through OpenRouter (`mistralai/…`) | Mistral AI is a French company. Every request is pinned to Mistral's own EU endpoint (`mistral/eu`, OpenRouter's provider routing with `only` and no fallback), never to another company hosting its open-weight models. |
| Ollama (`ollama:…`) | The model runs on the machine or the servers that run Quorumind: on the premises, the prompts do not leave that infrastructure, whoever made the model. |
| The recorded demo | It calls no model. |

Anthropic, OpenAI and Google models are not European, even when served from an EU region.

**What is guaranteed, and what is not.** OpenRouter is a US company. With the default address
(`https://openrouter.ai/api/v1`), a request goes through OpenRouter's global servers, which may be outside the EU, before
reaching Mistral's EU endpoint: the model runs in the EU, the path to it may not. OpenRouter offers in-region routing on
its Business and Enterprise plans: requests sent to `https://eu.openrouter.ai/api/v1` are processed in Europe, and fail
rather than leave it when no European endpoint serves the model. Account, billing and security metadata may still be
stored in the US (see OpenRouter's [in-region routing guide](https://openrouter.ai/docs/guides/features/in-region-routing)).
Set `OPENROUTER_EU_BASE_URL=https://eu.openrouter.ai/api/v1` to send the European-only sessions there (or
`OPENROUTER_BASE_URL` to send every session there, which limits the catalog to the models OpenRouter serves in Europe).
The interface, the session and the report's method box say which of the two paths a session took.

**Defaults.** `QUORUMIND_EUROPEAN_ONLY=1` ticks the option for every new session; `QUORUMIND_EUROPEAN_ONLY=required`
imposes it. The hosted version has the same choice as a workspace setting, for its owners and admins.

**Validation.** A European-only session that asks for another model is refused with HTTP 400 and the code
`non_european_model` (`params.model` names it as `provider:model`); when the server has no European model at all, the
code is `european_unavailable`. Without a lineup, the session gets the European default: the first European model
interviews and rules, and faces a model of another maker when there is one, else another model.

## Compliance templates

Templates add interview focus points and requirements, and can be combined with a project type (SaaS + health data):

| Template | Requirements (hard ones in bold) |
| --- | --- |
| Personal data (GDPR) | **lawful basis and minimisation (art. 5, 6)**, **processing agreements (art. 28)**, **transfers outside the EEA (chapter V)**, **retention (art. 5(1)(e))**, rights of the people (art. 15 to 22), security and breach notification (art. 32, 33), impact assessment when required (art. 35), consent for trackers (ePrivacy art. 5(3)) |
| Health data | **GDPR article 9 exception**, **HDS certification in France (Public Health Code L.1111-8)**, **HDS hosting in the EEA (2024 framework)**, access control and encryption, impact assessment |
| Public sector | **SecNumCloud for sensitive state data (cloud au centre doctrine, SREN law art. 31)**, **RGAA accessibility (law 2005-102 art. 47)**, RGS security accreditation, sovereignty of each component, reversibility and procurement |
| Finance | **DORA (regulation 2022/2554)**, **DORA contracts with ICT providers (art. 28, 30)**, **PCI DSS when card data passes through**, anti-money laundering record keeping |
| Consumer law (online sales) | **pre-contractual information (directive 2011/83 art. 6)**, **order button (art. 8(2))**, **withdrawal and refund, and the withdrawal function from 19 June 2026 (directive 2023/2673)**, **European Accessibility Act (directive 2019/882)**, legal guarantee, price reductions, reviews, consumer mediation in France |

The requirements sheet's compliance boxes bring requirements in too: personal data, health data and public sector bring
their template's requirements, payment card data brings PCI DSS. A template ticks the boxes it stands for.

The proposers must meet the requirements, the critics raise a blocking critique when a hard one is not met, and the
arbiter assesses every option against every requirement: met, partly met, not met, or does not apply, with a one-line
reason. An option that does not meet a hard requirement is infeasible, and is never recommended. The report has a
Compliance section with this table, in the session's language.

The texts state each rule and its source without adding to it; when a rule depends on facts about the project, they
say to check whether it applies. They are a checklist for the debate, not legal advice.

## Reference cloud prices

`packages/core/reference/cloud-prices.json` holds public list prices of a small VM, managed PostgreSQL, object storage and
internet egress at OVHcloud, Scaleway, AWS, Azure and Google Cloud in Europe, each with the address it was read from and
the date. The proposers read them as reference figures ("check them before committing"), and the report's method box
gives their date.

`npm run prices:check` checks the file and warns when it is older than 90 days (`-- --strict` fails instead, for a
scheduled job); the bench warns too. To update it, read each figure again from its source, change `asOf`, and leave out
any figure that cannot be verified.
