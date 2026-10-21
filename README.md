# Comps

**Launch research for indie game developers and self-published authors, built on Qloo's taste data.**

You describe your game or book and, optionally, a few titles it feels like. Comps works out who that audience is and where else they spend their attention (podcasts, artists, TV shows, brands, books), then turns it into a launch plan. Every recommendation links to the Qloo result it came from, and anything that is not Qloo data is labelled as interpretation.

## 1. The problem

Indie creators rarely know who their audience is beyond "people who like games like mine". Publishers answer this with "comps" (comparable titles) and paid audience research; a solo developer or self-published author usually guesses, then spends a small marketing budget in the wrong places. The question they actually need answered is cross-domain: *people who love Stardew Valley — which podcasts do they listen to, which artists, which shows?* That is what Qloo's taste graph models.

## 2. Qloo workflows used, and why

| Tool the agent calls | Qloo endpoint | Why |
|---|---|---|
| `qloo_search` | `GET /search` | Resolve the creator's comps (and comps the agent proposes) to Qloo entity IDs. |
| `qloo_insights` | `GET /v2/insights` with `filter.type` + `signal.interests.entities` / `signal.interests.tags` | The core step: what the comps' audience also likes in **other** entity types (podcast, artist, tv_show, brand, book, movie). |
| `qloo_tags` | `GET /v2/tags` | Turn a theme from the pitch ("cozy", "roguelike") into a tag signal. |

The agent (Claude, via the Anthropic tool-use API) decides which comps and domains to query, notices empty results and tries another comp or domain instead of guessing.

**Provenance by construction.** Every Qloo call is stored server-side as an evidence record (E1, E2, …). The report is written as structured output where each comp, channel and positioning point must cite evidence IDs, and the server then **drops any item whose name does not appear in the evidence it cites** (the UI lists what was dropped). Clicking an evidence chip shows the exact Qloo query and results behind a recommendation.

## 3. Request → result walkthrough (redacted)

_To be filled with a real run once the hackathon API key is active: the input pitch, the entity/tag choices the agent made (with IDs redacted to their type), and how one Qloo result became one line of the plan._

## 4. Demo

- Live demo: _link after deployment_. The landing page has finished sample plans you can open without waiting.
- Screenshots / short video: _to be added_. They contain no API keys or personal data.

## 5. Run it from a clean environment

Requirements: Node.js 22.18 or newer, an Anthropic API key, a Qloo hackathon API key.

```sh
git clone <this repo> && cd comps
npm ci --ignore-scripts
cp .env.example .env     # set ANTHROPIC_API_KEY, QLOO_API_KEY, QLOO_MODE=live
npm start                # web on http://localhost:5173, API on :3001
npm test
```

Without a Qloo key, `QLOO_MODE=mock` runs everything on synthetic data marked "(mock)". The agent is instructed not to treat mock data as evidence, so a mock run produces an honest, mostly empty plan; it is for testing the flow, not the output.

Sample plans for the landing page are generated with `scripts/make-sample.ts` against the live API and stored outside the repository (Upstash Redis when `KV_REST_API_URL`/`KV_REST_API_TOKEN` are set, otherwise `cache/`, which is gitignored), because Qloo response data must not be committed to a public repository.

## 6. Known limitations — what a result does not establish

- Qloo results describe what **groups** of people tend to like. They say nothing about what any individual will do, and an affinity is not a prediction of sales or conversions.
- Small indie titles may not exist in Qloo's graph; the plan then rests on larger comps the creator or agent picked, which skews toward a more mainstream audience.
- Sections labelled "interpretation" (e.g. tone, tagline ideas) are the model's suggestions, not Qloo data.
- No personal data is sent to Qloo: only titles, themes and entity IDs.
- The public demo is rate limited and caches results by input.

## Data handling

API keys stay on the server and are never sent to the browser. Qloo responses are not stored in this repository. See Qloo's safe-use guidance in the hackathon kit.

## License

MIT
