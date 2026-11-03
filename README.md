# SiteSwarm

**From a planning consultant's documents to procedures a site can work from. AI agents read the package, code does the sums, and a person decides.**

A contractor receives a tender package of hundreds of pages, and has to turn it into work a crew can start on. SiteSwarm takes the whole package and works through the same steps a contractor's planner would:

```
Documents → AI analysis → WBS → Procedures → Cost estimate → Critical path → Gantt chart → 3D timeline → Kanban
```

It runs on Muse Spark and Muse Wonder through the Meta Model API, using [CAMEL-AI](https://github.com/camel-ai/camel) for each agent's turn and [mem0](https://github.com/mem0ai/mem0) for what the agents remember. It has been tried on a real Indonesian tender package, in [docs/](docs/README.md). **The sample project the app opens on is synthetic.** See [PROVENANCE.md](PROVENANCE.md).

## The flow

| | Tab | What it gives you |
|---|---|---|
| Set up | **Planning** | A new project starts here: its name and the consultant's package on one page, and one button that uploads it and starts the agents. Then the analysis workspace: the documents by category on the left, and in the middle what was taken from them, as scope, WBS and activities, schedule, dependencies, BOQ and costs, engineering requirements, procedures, and risks and constraints. Each item opens its source beside it, at the page it cites |
| Set up | **Review** | What a project manager has to decide: the extracted work packages, what is missing, where the documents conflict, unresolved dependencies, unverified assumptions, and what needs their input. Accept or reject one item or a whole section, correct who answers for a work package or the wording of a question, then approve or reject the plan. Each section says what a decision there changes |
| Workspace | **List** | The work packages as a table: dates, float, worth, tasks and man-hours |
| Workspace | **WBS** | The breakdown as an outline or a tree, the control accounts, and the WBS dictionary |
| Workspace | **Timeline** | The schedule, with its baseline and tasks |
| Workspace | **Critical Path** | Earliest and latest dates and the float, worked out by code, the network of the work, and the chain that holds the finish date |
| Workspace | **Kanban** | Once the plan is approved, its tasks on a board. Hold points stop what follows them |
| Workspace | **3D Timeline** | The building as the schedule builds it, day by day: slide the day or press play, and see what is built and what is being worked on. Click a part to see the work package that builds it |
| Records | **Procedures** | Each task as a foreman would follow it: the steps, the crew, the material, the equipment, the safety points, what passes inspection, the exact words in the documents it rests on, and whether it is ready to start |
| Records | **Cost** | What the work is worth, by control account and work package, with the S-curve, the BoQ and the take-off |

Every view of the Workspace reads the same work packages. The **AI Copilot** beside any tab is one Muse agent that reads the live records and advises: it changes nothing, and code checks every figure it states. Each question uses a little API credit.

Procurement, QA/QC, the document register, RFIs, the control tower and risks are still there and still hang on the same WBS. They are off the menu to keep the flow plain, and links open them when they are needed: an RFI to answer, a hold point to sign.

## What happens to a real package

| Step | Who | What |
|---|---|---|
| **Sort** | Code | Decides what each file is from its name and what it holds. Bid and award records, instructions to bidders and empty notes are set aside and never reach a model. A person can overrule it, file by file |
| **Read the tables** | Code | Reads the master schedule by where its cells sit, and the priced recap, and checks both against the totals they print. The schedule's groups become control accounts and its rows work packages, and the recap's values are spread by the schedule's weights. It also reads each line of a BoQ that has them, with its page |
| **Check the rules** | Code | Applies Indonesian construction regulations, with no model: flags a regulation the documents cite that has since been revoked, works out the safety risk level the package's own facts point to and drafts the question to the owner, and finds what the contract requires before work starts, while it runs and at handover, in the package's own words, with the regulation behind each |
| **Find the pages** | Document controller | Says which pages of the specification bear on each work package. Where one schedule row lumps several crews together, as one row for all the electrical work does, it splits the row along the specification's sections. Code keeps the parts inside the row's weeks and makes them add up to what it is worth |
| **Write the procedures** | One planner per work package | Reads those pages and writes the tasks and procedures, in the language of the documents |
| **Write the WBS** | Planning engineer | Writes the breakdown from the documents. With no schedule code can read, that breakdown is the plan's, and a check says so. With one, the schedule's rows, weeks and weights stand, and code flags a row the engineer left out, or work the documents require that no row covers |
| **Link** | Planning engineer | Says what must come before what. Code works out the float, keeps the master schedule's dates, and draws the WBS tree and the critical path network |
| **Review** | QA reviewer, on the other model | Looks for where the documents disagree and what must be settled before work starts |
| **Plan** | Code | Puts it together. Nothing reaches the board until a person approves |

### What code checks

An agent's answer is not trusted because it sounds right:

- **Every quotation is checked against the page it cites.** Words that are not there are dropped, and a finding left with no quotation is dropped with them.
- **Every figure in a procedure is checked against the pages its planner read.** One that is not there is marked on the task, for a person to check.
- **A task that cites nothing says so,** and rests on the agent's knowledge.
- **A work package whose name the pages never use is flagged.** On the example package, the schedule's biggest architectural item is "Fasade", and the specification never uses that word.
- **A link against the master schedule is refused and reported,** as is work left with nothing linked after it.
- **What the package does not have is listed:** a BoQ that is only a recap, no inspection plan, no structural drawings, drawings that are only pictures. Agents are told to ask rather than guess what these would have said.

### Indonesian regulations

The rules a contractor's plan has to meet are in [swarm/regulations.py](swarm/regulations.py): a short register written by hand from the official texts. Each rule has its article, its exact words and a link to the text, and each regulation says whether it is still in force (checked on 2026-11-03). Code applies them and names the article it applied. The planners are told only the rule that bears on their work.

| Regulation | What the app does with it |
|---|---|
| Permen PUPR 10/2021, SMKK | Works out the safety risk level the package points to (Pasal 34) and the safety staff it calls for (Pasal 38). Marks each task that is special work, such as scaffolding, lifting, welding or excavation, as needing a work permit that carries its method statement, safety analysis (AKK) and inspection plan (Pasal 26 and 27). Lists the safety plans to be approved at the pre-construction meeting (Pasal 21 and 24), the reports (Pasal 28), and the safety documents due at handover (Pasal 30) |
| Permen PUPR 14/2020, the standard contract | Mutual check 0%, when a contract becomes critical, the late-finish penalty, the minimum maintenance period, and as-built drawings |
| UU 2/2017, Jasa Konstruksi | Every construction worker certified (Pasal 70) |
| Revoked regulations | Flags a citation of one: the UGM specification cites Permen PUPR 1/2022 on cost estimates, revoked by Permen PUPR 8/2023, and UU 11/2020, replaced through UU 6/2023 |

All of it shows where it applies: first on the Procedures tab, under **Before any work starts**, then on each task and in the download. Where the documents give the same thing differently, code says so. The UGM contract gives a maintenance period of 180 working days, and its specification 180 calendar days.

There is no separate screen for regulations, and no vector store. Meta's API has no embedding model, the rules a plan needs are few, and they change: since 2023 alone, four of the regulations in the register have been replaced. A register records which are still in force, and code can check a citation against it, which a search over texts cannot.

### The 3D timeline

[swarm/model3d.py](swarm/model3d.py) works out a schematic model of the building, and [ui/src/components/site/Model3DModule.tsx](ui/src/components/site/Model3DModule.tsx) draws it with [three.js](https://threejs.org). It is a picture of the order of the work, not a BIM model, and the screen says so.

| What | Where it comes from |
|---|---|
| The floors | The WBS: "Lantai Basement", "Lantai 01" to "Lantai 05", "Lantai Atap" |
| What each work package builds | Its name and its control account's: excavation, piles, each floor's slab and columns, walls, windows, facade, roof, services, fit-out, external works. One the code cannot place is listed, and not drawn |
| When | The master schedule's dates, as the Critical Path and Timeline tabs use them |
| The size | The drawings' own text, where it gives it. On the UGM package, the grid of 7 m bays, 28 by 21 m, and the semi-basement at −3.25 m are on sheet 6, and sheet 3's floor areas add up to the total it prints |
| The roof | Pitched where the documents speak of roof tiles or a roof frame, flat otherwise |
| The tower crane | Shown while the foundations and the frame go up, where the contract lists one |

Work that runs over every floor, such as masonry or finishes, is drawn going up floor by floor, and only on a floor whose structure is finished. That is how such work usually goes, not something the documents state. Floor to floor is taken as 4 m where the drawings read do not give it, and the screen lists each such assumption.

### What the cost is, on such a package

If the BoQ is only a recap, cost is top-down: what each group of work is worth, spread by the schedule's weights. The screen says so. Man-hours are the agents' estimates, not a calculation from quantities. A task's crew and time are estimates too, and are labelled as such.

### How the screens connect

Every task, RFI, order, inspection and cost hangs on a WBS code, so a change in one place shows up in the others. The links are real:

- **Board to schedule.** An activity's progress comes from its tasks' man-hours. Moving a card moves the Gantt, and the control tower with it.
- **Schedule to board.** A task's dates follow its activity. When a recovery plan moves the pour, the cards' due dates move.
- **QA/QC to board.** Only an inspection's result closes its card. A pass lets what waits for it go on. A fail raises an NCR and stops the work behind it until that closes.
- **Hold points are rules.** Code refuses to start work past an unsigned hold point, and says why.
- **Documents to board.** An open RFI holds the tasks that name it, and a task citing a replaced drawing is flagged.
- **Procurement to board.** Material not yet received shows on the task that needs it, and an order that may already cover a request is pointed out.
- **Pick any WBS node** and every module shows only what hangs on it.

## An agent on Procurement, QA/QC and the control tower

Once work is under way, these screens each have an agent that reads their live records and recommends what to do next. Offline, code works the recommendations out by rule, at no cost and with no model. On Muse, one call reads the records, and code then drops anything citing a record that does not exist or a figure the records do not hold.

Agents propose, people decide. A recommendation changes nothing until a person accepts it, and even then an RFI is only a draft and a hold point still needs signing.

### What the agents remember

Without memory, an agent starts from nothing every time and asks again about what you dismissed yesterday. With it:

- **What goes in is what people do:** a recommendation dismissed or accepted, a failed inspection, what closed an NCR, an RFI's answer, a plan rejected with a reason, work that ran over its plan, and notes you write. Nothing a model said goes in, so a model's mistake cannot come back later as something it remembers.
- **A decision stays decided** until the figures behind it change or you bring it back, and the next recommendation in line moves up.
- **A lesson goes where it bears on something.** It shows on the recommendation, and on Muse the module's agent and the swarm read it too. It is context, not evidence: code checks every recommendation against the live records alone, so a figure only memory holds is dropped.
- **You can read and correct it** on the Planning tab, under What the agents should know. Forgetting takes something out of what the agents read, off the cards that quote it, and off the disk. The audit trail says it was forgotten, and not what it said.
- **Each project has its own,** beside its records, and resetting the scenario clears the scenario's.

Keeping a memory sends nothing anywhere. Left alone, mem0 reports usage to PostHog and fetches notices from GitHub: both are switched off, and a test runs it with every connection refused. When an agent is asked on Muse, what it remembers does go to Meta with its records, as part of its instructions.

## The sample project

The app opens on a synthetic project, Harbor Point Block B, with a consultant's package written for it. For Level 4 columns, the swarm breaks the work down under its programme activities, A50 and A60: rebar, formwork, concrete, and erection and casting, each down to tasks. Open any task for:

| | For each task |
|---|---|
| **Procedure** | What to do, with the method, tolerance and safety points, and the documents it comes from |
| **Workforce** | Trades and numbers, hours and man-hours, from SNI 7394:2008 |
| **Material** | Net need, waste, and the amount to order |
| **Waste** | In quantity and rupiah, with where each figure comes from, and what could be taken out |
| **Inspection** | Where it sits, what passes, who signs, and whether work stops until they do |

The package disagrees with itself in the ways real packages do, and the swarm has to notice: a superseded drawing still in the set, a BoQ priced on it (rebar is about 30% short), a specification stricter than the drawing, a programme that allows far too few workers and leaves out the rebar subcontractor, and an open RFI holding two columns.

## Agents reason, code calculates

| Agents decide | Code works out |
|---|---|
| Which drawing is in force, and what the sum for a quantity should be | The sum: only numbers and `+ - * / ( )` are read, and every figure must be one the agent read |
| What the tasks are, in what order, and how to do each | Workforce and material from the norm chosen, in [swarm/norms.py](swarm/norms.py) |
| Who does each task, with how many people | Hours, the critical path, and the crew on site day by day |
| Where waste could come out | Waste, cost and the comparison with the BoQ |
| What in the documents disagrees | [Its checks on the breakdown](swarm/wbs.py), bottlenecks, delays and readiness, always on |

The workforce and material norms are the Indonesian national standard's own figures: SNI 7394:2008 gives 10.5 kg of rebar for every 10 kg fixed, with 0.07 OH of labourer and 0.07 OH of steel fixer. Where the standard states no waste allowance, none is claimed.

## The loop on the sample project

1. **Read.** Analysts read the package and the live records, and flag what disagrees.
2. **Plan.** Code works out the quantities. A planner per section writes its operations. Leads link the sections, place inspections and handling, assign crews, find waste and settle what disagrees.
3. **Attack.** A reviewer and the red team, on the other model, try to break it.
4. **Approve.** Nothing changes until a person approves. Then the tasks go on the board, the inspections to QA/QC, and the material to Procurement.
5. **Track.** Move cards, sign inspections, and record what each task really took. Code compares it with the plan, and over-use goes to the risks.
6. **Re-plan.** When something goes wrong on site, a disruption review works out the recovery. Approving it moves the schedule, and the board follows.

## Run it

You need Python 3.12 with [uv](https://docs.astral.sh/uv/) and Node.js.

```
uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe -r requirements.txt
start.bat
```

`start.bat` builds the screens the first time, starts the API on port 8300 and the screens on port 8310, and opens http://127.0.0.1:8310. After changing the screens, run `npm run build` in `ui/` before starting again. On another system, run `python -m swarm.firm_api`, then `npm install && npm run build && npx next start -p 8310` in `ui/`.

To plan from your own documents, press the **+** beside the project name, name the project, drop in the whole package, and press **Upload and analyze**, which starts the agents straight away. It needs a key: copy `.env.example` to `.env.local` and add `META_API_KEY`. It uses API credit, and a run stops when its estimated spend passes `SWARM_MAX_USD` (default $150, the event's API credit). The estimate uses listed prices, so check your real usage with Meta.

A project of your own has its own records in its own file, separate from the sample. What you enter there is yours, not synthetic. A document goes to a real model only when you press the button, and then only the pages the agents need, from the documents not set aside. Photos go only if you ask an agent to read one.

There is an offline mock for development, through the API and in the tests, where the agents, tools and checks run for real but the models' answers are scripted. No screen offers it. **A mock run proves the wiring and the arithmetic. It says nothing about how well a model plans.** Without a key, the agents on the off-menu screens still work offline, by rule.

## Agents propose, people decide

Agents have no tool that changes a record. A plan, a work item, an RFI and a message are all proposals until a person acts on them. Hard rules are refused by code: a subcontractor cannot be approved with a document missing or expired, an invoice cannot be certified past the verified work, work cannot start past an unsigned hold point, and an inspection cannot be closed by dragging its card.

### Messages over MCP

Agents read channels and draft replies through [MCP](https://modelcontextprotocol.io) servers, so a real Slack, WhatsApp or Gmail server can replace the demo without touching the agents. Put them in `mcp.json` at the root:

```json
{"mcpServers": {"my_messages": {"command": "python", "args": ["-m", "my_server"]}}}
```

Each server must offer the tools `read_messages` and `draft_message`. This repository ships only the demo server, which holds fictional messages and has no way to send one: **approving a message records the approval, and nothing leaves the machine.** Sending for real is not built.

## What was reused

Not everything here is new. The swarm engine and the agent screens are adapted from the author's earlier, private agent swarm, built for a different domain: the phases, handoffs, code checks, QA on a second model, red team and validation contract in [swarm/firm.py](swarm/firm.py), and the animation, network and run views in [ui/src/components/aip/](ui/src/components/aip/). No data or figures from that work are here.

Written for this project: reading a real package, the planning swarms and WBS calculator, the construction cases, the project records and their rules, the screens in [ui/src/components/site/](ui/src/components/site/), the decision loops, the agents on the modules, the MCP connector, the scripted models and the tests.

## Where things are

| Path | What it is |
|---|---|
| [swarm/package.py](swarm/package.py) | A real package, read by code: sorting it, the master schedule, the priced recap, and what is missing |
| [swarm/package_firm.py](swarm/package_firm.py) | The swarm on a real package, from the documents to procedures, and what code checks in what the agents write |
| [swarm/regulations.py](swarm/regulations.py) | Indonesian construction regulations: the register, and the rules code applies |
| [swarm/model3d.py](swarm/model3d.py) | The 3D timeline's model: the floors, what each work package builds and when, and the size from the drawings |
| [swarm/modules.py](swarm/modules.py) | The screens as one system: the WBS tree, work packages, procedures, the critical path, the cost estimate, the board, readiness, delays, the tower |
| [swarm/project.py](swarm/project.py) | The records, the rules that flag problems, the decision loops, and projects |
| [swarm/module_agents.py](swarm/module_agents.py) | The agent on each module, and reading a document or a photo |
| [swarm/memory.py](swarm/memory.py) | What the agents remember, on mem0, and the word matcher. Everything that knows about mem0 is here |
| [swarm/extract.py](swarm/extract.py) | Reading a document with no model: its text, and the facts rules can find |
| [swarm/planner.py](swarm/planner.py) | The planning swarm on the sample project |
| [swarm/wbs.py](swarm/wbs.py) | The breakdown: every figure, the WBS codes, and the checks |
| [swarm/norms.py](swarm/norms.py) | Workforce and material from SNI 7394:2008 |
| [swarm/planning_case.py](swarm/planning_case.py) | The consultant's package |
| [swarm/firm.py](swarm/firm.py), [swarm/site_case.py](swarm/site_case.py) | The disruption review, and its case and critical path |
| [swarm/llm.py](swarm/llm.py) | One agent's turn on CAMEL-AI. Everything that knows about the framework is here |
| [swarm/firm_api.py](swarm/firm_api.py), [swarm/project_api.py](swarm/project_api.py) | The API |
| [swarm/mock_package.py](swarm/mock_package.py), [swarm/mock_plan.py](swarm/mock_plan.py), [swarm/mock_firm.py](swarm/mock_firm.py) | The scripted models behind the offline mock |
| [swarm/connectors.py](swarm/connectors.py), [swarm/mcp_demo_server.py](swarm/mcp_demo_server.py) | MCP |
| [swarm/vision.py](swarm/vision.py) | Reading site photos. Code works out the percentage |
| [swarm/generator.py](swarm/generator.py), [swarm/reconcile.py](swarm/reconcile.py) | The synthetic claim, and the comparison behind Claims |
| `swarm/agents.py`, `tools.py`, `mock_llm.py`, `runner.py`, `score.py`, `server.py`, `web/` | The first prototype, a progress claim checker. The app no longer runs it |

## Tests

```
.venv/Scripts/python -m pytest tests -q
```

Offline and free. [tests/test_package.py](tests/test_package.py) follows the real documents in `docs/` from sorting to the board, with a scripted model. [tests/test_modules.py](tests/test_modules.py) follows the work through the screens. [tests/test_memory.py](tests/test_memory.py) holds what the agents remember, and proves nothing tries to leave the machine. [tests/test_plan.py](tests/test_plan.py) covers the standard's figures, the sums, the calculator, the checks and the planning loop. [tests/test_site.py](tests/test_site.py) covers the records and the disruption loop. [tests/test_swarm.py](tests/test_swarm.py) covers the prototype and the synthetic data. None of them say how well a real model reasons.

## What has been tried on real Muse

Two full runs on 2026-11-03, one on each package. Costs are at listed prices.

| | UGM package | Unair package |
|---|---|---|
| Cost and time | $1.56, about 6 minutes | $1.06, about 7 minutes |
| Documents read | 8 of 19 | 5 of 14. A person left out the brief for another building |
| Breakdown | Code read 31 rows of the schedule, and an agent split two of them: 35 work packages | No schedule code could read, so the planning engineer wrote 42 work packages under 12 control accounts and estimated every date. An agent split one: 44 work packages |
| Tasks written | 319, none lost | 268, none lost |
| Quotations checked | 1,194, 15 dropped | 471, none dropped |
| Tasks citing nothing · stating figures their pages do not | 1 · 21 | 25 · 4 |
| Where the documents disagree | 9 | 6 |
| Questions drafted | 105 | 136 |
| BoQ lines read by code | None: the package has only a recap | 445, all with descriptions, none priced |

The UGM run came before the planning engineer wrote a WBS beside a readable schedule, so that step has not run on real Muse. The Unair run went through the first screen as a person would, and one question to the AI Copilot on its plan cost $0.03. Code made the Copilot correct a figure in that answer.

Before those runs, trials on throwaway storage cost about $1.70. Planners ran on samples of the work packages:

| | UGM package | Unair package |
|---|---|---|
| What it is | Weekly schedule and priced recap, no quantities | Quantities, no prices, no weekly schedule |
| Documents read | 8 of 19 | 6 of 15 |
| Breakdown | Code read 31 work packages from the schedule. An agent split the two services rows, so 37 to 47 in all, differing from run to run | An agent drafted 39 from the BoQ's headings, and estimated every date |
| Planners run | 9 work packages | 2 work packages |

What those runs showed:

- **Quotations:** code checked 479 against their pages and dropped 2. All 155 tasks written cited at least one page. A quotation being on the page shows the words are there, not that the procedure follows from them.
- **Findings:** on Unair, the reviewer raised three things already noted by hand in [docs/README.md](docs/README.md), which its prompt does not mention: the unanswered question of which document governs, the BoQ stated as not binding, and a promised addendum. On UGM it raised, among others, the pile test differing between the BoQ and the RKS, and soil data given only to the winning bidder. Nobody who knows these projects has checked these findings.
- **Damaged answers:** in one trial, 3 of 5 planner answers had miscounted brackets, and one work package lost its procedures. Code now reads such answers piece by piece. All three saved answers replay in full, and in the last trial the same work package came back damaged again and all 9 of its tasks were read, with no retry.
- **Work permits:** told what Permen PUPR 10/2021 Pasal 26 and 27 require, the planners on two UGM work packages made getting the permit the first step of 7 of their 18 tasks. Code flagged those 7 and 3 more: rebar fixed from a scaffold, grinding, and an inspection done in a harness.
- **Cost and time:** the trials pointed to about $0.05 per planner and $2 to $3 for a full run. Both full runs came in under that, at about $0.02 to $0.04 per work package. Two runs are not a basis for a promise.

Nobody in construction has reviewed these procedures. Read them as a first draft for a site engineer.

## Regenerating the assets

`assets/` holds the generated photos and log wording, so running the app costs nothing. To make them again: `python tools/make_assets.py --help` (needs `META_API_KEY`). Check the counts after any new photo, because image models do not reliably draw an exact count.

## Known limits

- **What the first screens do not extract yet.** Each needs work in the swarm, and none is faked on the screen:
  - **One statement of the project's scope and objectives.** The planners write scope work package by work package.
  - **BoQ lines as part of the plan's numbers.** Code reads each line, with its volume, unit, any price and its page, and shows them on the BOQ section. They are not yet tied to work packages or listed as materials, and cost still starts from the priced recap, spread by the schedule's weights.
  - **Technical specifications as records of their own.** What the planners took from them appears as each task's acceptance criteria and quoted sources.
  - **Document versions.** Identical files are noticed, but a new revision is not linked to the one it replaces.
  - **A source for every date.** A date read from the schedule leads back to the schedule as a whole, not to its row.
- **Review has limits.** A rejected work package stays in the consultant's schedule and gets no tasks. Rejecting a missing item, a conflict or an assumption is recorded and changes nothing else. Only who answers for a work package and the wording of a question can be edited there. Dates and links are changed on the Timeline tab.
- **Tried on two real packages, not proven on them.** See [What has been tried on real Muse](#what-has-been-tried-on-real-muse). The procedures are a first draft for a site engineer to check. A quotation that passes shows the words are in the document, not that the procedure follows from them.
- **Drawings are read as text only.** A drawing set that is only pictures reaches no agent, and the screen says so. Muse can read images, but this does not use that yet.
- **Sorting goes by rules written from two Indonesian packages.** Other packages may sort differently, and a person can overrule any file. It cannot tell that a file belongs to a different project: the second example package holds a brief for another building, which only a person will leave out.
- **Reading a master schedule by position works on a Kurva-S with `M-1`, `M-2` week headings** whose weights add up to 100. Anything else goes to an agent, whose dates are estimates, and a check says so.
- **A split row's weeks and shares are the agent's estimates,** and a check says so.
- **The critical path is only as good as the links,** which are the planning engineer's judgement. Work that overlaps by more than half of what comes first is treated as running side by side. That threshold is a choice, not a measurement.
- **The regulation register is small, and checked by hand as of 2026-11-03.** It holds what a contractor's plan meets most, not all of Indonesian construction law, and a regulation it does not know of is not flagged. Two points could not be confirmed from the scanned official texts: the number of the standard contract's penalty clause, and the article of UU 6/2023 that revokes UU 11/2020. For the latter it relies on the official register's listing.
- **Special work is found by a task's own words,** in Indonesian and English. A task described in other words is missed, and a word such as "galian" in a task that only carries spoil away flags it all the same.
- **The 3D timeline is schematic.** The building is a box on the drawings' grid, with the same columns, walls and windows on every floor. It shows the order of the work, not the design: the package's drawings are 6 of 189 architectural sheets, and none is structural.
- **The owner sets the safety risk level.** Code says what the package's value and lifting equipment point to. A package does not state the number of workers or the level of technology, so those are not judged.
- **A disruption review reads the scenario only.** A project of your own has no progress claims yet.
- **Norms cover concrete work.** Rebar, formwork and concrete have the standard's figures. Handling and inspection tasks are the agents' estimates, and are marked as such.
- **A plan, not a day-by-day schedule.** Durations assume a task's whole quantity runs in one go, so a pour that really cycles batch by batch is simplified. The critical path counts calendar days.
- **Recovery options are worked out on the scenario's own programme.** A dependency you change moves the live schedule, but not the costed options in a disruption review.
- **Scanned PDFs have no text to read** without a model, and there is no OCR. Facts read by rules are what a document states, not a judgement on it.
- **Offline, photo defect review is scripted,** and says so. Only a real model reads a photo.
- **The value of a swarm over one good agent is not proven here.** No comparison has been run.
- **The author wrote both the cases and the prompts,** and the traps in them are known to whoever wrote them. A good result on them is not evidence of accuracy on a real project.
- **The scenario is synthetic.** Site photos are AI-generated, and daily logs are reworded from templates. Real ones are messier.
- **No login or roles,** and one person on one machine.
- **`mcp` is held below 2,** because CAMEL-AI 0.2.90 does not import with it.
- **Memory matches words, not meaning.** Meta's API has no embedding model, so a small matcher finds the words and record ids two texts share. "Timber" does not find "plywood", and a shared ordinary word can bring in something unrelated. Its cut-offs were chosen on a few dozen cases written by hand, in [tests/test_memory.py](tests/test_memory.py): a sanity check, not a measure of accuracy.
- **A dismissal holds while the words stay the same.** If the risk grows but no figure in the recommendation changes, it stays dismissed, shown faded with a way to bring it back.
- **One API at a time keeps memory.** Its store locks its folder. A second API on the same data runs without memory and says so.
- **`mem0ai` is pinned, and `fastembed` must stay out.** With fastembed installed, mem0 downloads a model from Hugging Face without asking.
