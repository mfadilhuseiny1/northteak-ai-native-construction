# SiteSwarm

**From a consultant's planning documents to a plan the site can build from.**

An AI agent swarm reads a work item's documents (drawings, specification, BoQ, programme, inspection plan) and writes an Operation Process Chart and
procedure: every operation and inspection in order, with the workforce, material and waste of each step. It says where the documents disagree. A person
approves, and the plan becomes work items, planned inspections and material requests. When reality breaks the plan, the same swarm works out how to recover.

It runs on Muse Spark and Muse Wonder through the Meta Model API. **All project data here is synthetic.** See [PROVENANCE.md](PROVENANCE.md).

## What it produces

For Level 4 columns, from nine consultant documents, the chart comes out in the shape a civil engineer would draw: rebar, formwork and concrete feeders
merging into a main stem. Open any step for:

| | For each step |
|---|---|
| **Procedure** | What to do, with the method, tolerance and safety points, and the documents it comes from |
| **Workforce** | Trades and numbers, hours and man-hours, from SNI 7394:2008 |
| **Material** | Net need, waste, and the amount to order |
| **Waste** | In quantity and rupiah, with where each figure comes from, and what could be taken out |
| **Inspection** | Where it sits, what passes, who signs, and whether work stops until they do |

The package disagrees with itself in the ways real packages do, and the swarm has to notice: a superseded drawing still in the set, a BoQ priced on it (rebar
is about 30% short), a specification stricter than the drawing, a programme that allows far too few workers and leaves out the rebar subcontractor, and an
open RFI holding two columns.

## Agents reason, code calculates

| Agents decide | Code works out |
|---|---|
| Which drawing is in force, and what the sum for a quantity should be | The sum: only numbers and `+ - * / ( )` are read, and every figure must be one the agent read |
| What the steps are, in what order, and how to do each | Workforce and material from the norm chosen, in [swarm/norms.py](swarm/norms.py) |
| Who does each step, with how many people | Hours, the critical path, and the crew on site day by day |
| Where waste could come out | Waste, cost and the comparison with the BoQ |
| What in the documents disagrees | [Its checks on the chart](swarm/opc.py), always on |

The workforce and material norms are the Indonesian national standard's own figures: SNI 7394:2008 gives 10.5 kg of rebar for every 10 kg fixed, with 0.07
OH of labourer and 0.07 OH of steel fixer. Where the standard states no waste allowance, none is claimed.

## The loop

1. **Read.** Analysts read the package and the live records, and flag what disagrees.
2. **Plan.** Code works out the quantities. A planner per section writes its operations. Leads merge the sections, place inspections and handling, assign crews,
   find waste and settle what disagrees.
3. **Attack.** A reviewer and the red team, on the other model, try to break it.
4. **Approve.** Nothing changes until a person approves. Then the sections become work items, the inspections go to Quality, and the material becomes requests in
   Procurement.
5. **Track.** Record what each step really took. Code compares it with the plan, and over-use goes to the attention list.
6. **Re-plan.** When something goes wrong on site, a disruption review works out the recovery. If it shortens the time a work plan has, the plan is flagged.

## Screens

| Screen | What it holds |
|---|---|
| Project | Each work package along the workflow, what the rules flag, and where the plans stand |
| **Work plans** | The chart, steps, material and waste, workforce, findings and plan document. Approve, and record actuals |
| AI Agent Swarm | Watch the agents work on a review, with the full trail |
| Agents | The agent network and which records each lead owns |
| Decisions | Recovery plans, work items, message drafts and the audit trail |
| Schedule, Budget | Gantt with baseline and critical path; earned value, CPI and SPI |
| Subcontractors, Procurement | Onboarding, documents, invoices and retention; orders against need |
| Daily reports, Quality, RFIs, Claims | The site diary and photos; inspections and NCRs; the register; the monthly claim against the evidence |

Handover shows as a step not started yet. Submittals, change orders, a safety register, tendering, BIM and commissioning are not built.

## Run it

You need Python 3.12 with [uv](https://docs.astral.sh/uv/) and Node.js.

```
uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe -r requirements.txt
start.bat
```

`start.bat` builds the screens the first time, starts the API on port 8300 and the screens on port 8310, and opens http://127.0.0.1:8310. On another system, run
`python -m swarm.firm_api`, then `npm install && npm run build && npx next start -p 8310` in `ui/`.

Open **Work plans** and choose **offline mock**, which needs no key and costs nothing. The agents, tools and checks run for real, but the models' answers are
scripted. **A mock run proves the wiring and the arithmetic. It says nothing about how well a model plans.**

For a real run, copy `.env.example` to `.env.local` and add `META_API_KEY`. A run stops when its estimated spend passes `SWARM_MAX_USD` (default $150, the event's
API credit). The estimate uses listed prices, so check your real usage with Meta.

## Agents propose, people decide

Agents have no tool that changes a record. A plan, a work item, an RFI and a message are all proposals until a person acts on them. Hard rules are refused by code:
a subcontractor cannot be approved with a document missing or expired, and an invoice cannot be certified past the verified work.

### Messages over MCP

Agents read channels and draft replies through [MCP](https://modelcontextprotocol.io) servers, so a real Slack, WhatsApp or Gmail server can replace the demo without
touching the agents. Put them in `mcp.json` at the root:

```json
{"mcpServers": {"my_messages": {"command": "python", "args": ["-m", "my_server"]}}}
```

Each server must offer the tools `read_messages` and `draft_message`. This repository ships only the demo server, which holds fictional messages and has no way to send
one: **approving a message records the approval, and nothing leaves the machine.** Sending for real is not built.

## What was reused

Not everything here is new. The swarm engine and the agent screens are adapted from the author's earlier, private agent swarm, built for a different domain: the phases,
handoffs, code checks, QA on a second model, red team and validation contract in [swarm/firm.py](swarm/firm.py), and the animation, network and run views in
[ui/src/components/aip/](ui/src/components/aip/). No data or figures from that work are here.

Written for this project: the planning swarm and OPC calculator, the construction cases, the project records and their rules, the screens in
[ui/src/components/site/](ui/src/components/site/), the decision loops, the MCP connector, the scripted models and the tests.

## Where things are

| Path | What it is |
|---|---|
| [swarm/planner.py](swarm/planner.py) | The planning swarm |
| [swarm/opc.py](swarm/opc.py) | The chart: every figure, and the checks |
| [swarm/norms.py](swarm/norms.py) | Workforce and material from SNI 7394:2008 |
| [swarm/planning_case.py](swarm/planning_case.py) | The consultant's package |
| [swarm/firm.py](swarm/firm.py), [swarm/site_case.py](swarm/site_case.py) | The disruption review, and its case |
| [swarm/project.py](swarm/project.py) | The records, the rules that flag problems, and the decision loops |
| [swarm/firm_api.py](swarm/firm_api.py), [swarm/project_api.py](swarm/project_api.py) | The API |
| [swarm/mock_plan.py](swarm/mock_plan.py), [swarm/mock_firm.py](swarm/mock_firm.py) | The scripted models behind the offline mock |
| [swarm/connectors.py](swarm/connectors.py), [swarm/mcp_demo_server.py](swarm/mcp_demo_server.py) | MCP |
| [swarm/vision.py](swarm/vision.py) | Reading site photos. Code works out the percentage |
| [swarm/generator.py](swarm/generator.py), [swarm/reconcile.py](swarm/reconcile.py) | The synthetic claim, and the comparison behind the Claims screen |
| `swarm/agents.py`, `tools.py`, `mock_llm.py`, `runner.py`, `score.py`, `server.py`, `web/` | The first prototype, a progress claim checker. The app no longer runs it |

## Tests

```
.venv/Scripts/python -m pytest tests -q
```

Offline and free. [tests/test_plan.py](tests/test_plan.py) covers the standard's figures, the sums, the calculator, the chart's checks and the whole planning loop through the API.
[tests/test_site.py](tests/test_site.py) covers the records and the disruption loop. [tests/test_swarm.py](tests/test_swarm.py) covers the prototype and the synthetic data. None of
them say how well a real model reasons.

## Regenerating the assets

`assets/` holds the generated photos and log wording, so running the app costs nothing. To make them again: `python tools/make_assets.py --help` (needs `META_API_KEY`). Check the counts
after any new photo, because image models do not reliably draw an exact count.

## Known limits

- **One work item, from a package written for it.** The BoQ, rates and inspection plan are read from a structured copy of that package, so a new work item needs them added. Bringing your own
  documents is not built yet.
- **Norms cover concrete work.** Rebar, formwork and concrete have the standard's figures. Handling and inspection steps are the agents' estimates, and are marked as such.
- **A chart, not a day-by-day schedule.** Durations assume a step's whole quantity runs in one go, so a pour that really cycles batch by batch is simplified.
- **The value of a swarm over one good agent is not proven here.** No comparison has been run.
- **The author wrote both the cases and the prompts,** and the traps in them are known to whoever wrote them. A good result on them is not evidence of accuracy on a real project.
- **Everything is synthetic.** Site photos are AI-generated, and daily logs are reworded from templates. Real ones are messier.
- **No login or roles,** and one project on one machine.
