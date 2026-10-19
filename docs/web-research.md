# Web research

Without it, every fact of a debate comes from the models' memory: prices, current versions, end-of-life dates,
regulations and vendor limits can be out of date, and nothing a claim says can be checked. With web research, the facts
that matter are looked up before the proposals and carry their sources.

## What happens

1. Once the requirements sheet is confirmed, a researcher (the interviewer's model) reads the sheet, and only the sheet,
   and lists the facts the debate will depend on that may have changed: prices of the services likely to be proposed,
   current major versions and end of life of the candidate technologies, the regulatory points flagged by the sheet's
   compliance boxes, vendor limits. Each comes with a short web search query.
2. Quorumind checks every query before sending it: at most 120 characters and 16 words, no personal data (the PII
   masking rules find nothing in it), no project or organisation name. A query that fails is dropped, not rewritten.
3. Each remaining query is searched once per session (a session stopped and resumed does not search again), and the
   pages found are numbered S1, S2… with their address, title, an excerpt, the day they were read and the question they
   answer.
4. The researcher states what the excerpts say, each fact with the ids of its sources. Facts that cite no source found
   are dropped.
5. Proposers, critics, the devil's advocate and the arbiter read the facts with their ids, in the debate, in every
   revision or what-if ruling, and in an audit (its alternative, its findings and its ruling, market price ranges
   included). From the MCP server, `quorumind_start` takes `web_research`, and the verdict summary ends with the facts
   and their sources. A claim of the verdict is "verified" only when it cites at least one of those sources;
   one marked verified without a source is downgraded to "estimated" in code, as are verified claims stored before
   sources existed.
6. The report, its HTML/PDF and Word exports, the client deliverable and the client proposal list the facts and the
   numbered sources with their dates, and cite them from the claims. The method box says whether web research was used,
   when and through what engine, or why it was not.

The research never stops a debate: when it is off, skipped (no engine, budget, European-only) or fails, the debate goes
on from the models' knowledge and the report says so.

## Search engines

| `QUORUMIND_SEARCH` | How it searches | Price |
| --- | --- | --- |
| `openrouter` | OpenRouter's web plugin (`plugins: [{ "id": "web", "engine": "exa" }]`) on a small model (`QUORUMIND_SEARCH_MODEL`, `google/gemini-3.8-flash` by default) that reads the results. The engine is set explicitly (`QUORUMIND_SEARCH_ENGINE`: `exa` or `parallel`) so that no model's native search is used. The pages come back as `url_citation` annotations. | What OpenRouter reports in `usage.cost` (the total charged, search included); without it, the model's price plus the engine's price per request (Exa 0.007 USD, Parallel 0.005 USD). |
| `brave` | The Brave Search API (`BRAVE_SEARCH_API_KEY`), web results and their excerpts. | `BRAVE_SEARCH_PRICE_USD` per request, 0.005 USD by default. |
| not set | No web research: the option is not offered. | |

`QUORUMIND_LOCAL_ONLY=1` turns web research off. The recorded demo replays recorded results and searches nothing.

## What is sent to the search engine

Only the queries: short and generic, such as "PostgreSQL versioning policy end of life". Never the requirements sheet,
the attached documents, the answers, the organisation profile, names or personal data. The search engine (and, with
OpenRouter, the model that reads its results) receives the query and nothing else from the session. Operators should
list the search engine as a sub-processor and say what it receives.

## European models only

No search engine keeps the queries in Europe: OpenRouter's web search runs through Exa or Parallel (and none is offered
on OpenRouter's EU region), and Brave Search is a US service. A European-only debate therefore never searches. The
option is not ticked for such a debate; when it is asked for anyway, the research is skipped and the report says why.

## Cost

The research has its own budget inside the session's cost cap: `QUORUMIND_RESEARCH_BUDGET_USD` (0.30 USD by default),
and never more than 15 % of the cap, so that the debate and the verdict keep their room. Before each search, the
research checks that the search and the researcher's last call still fit; the searches that do not are not made.
`QUORUMIND_RESEARCH_MAX_QUERIES` (6 by default, 12 at most) caps the searches. Every search is a usage record (task
`search`) with its cost, and the estimate shown before a debate includes the research.
