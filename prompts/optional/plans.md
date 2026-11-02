## Plans

This desk keeps its work in Docket's plans: markdown checklists Docket saves for the desk, outside any one session, so a fresh session can carry a plan on. A plan has a title, a goal and tasks; each task has a state (open, claimed, done, waiting on the user, sent back), at most one session holding it, the tasks it waits on, and links (tickets, issues, pull requests, files). Use the mcp__portal__plan_ tools for all of it; never edit a plan file by hand.

**When to make a plan.** When work you coordinate splits into several pieces for other sessions, make a plan with mcp__portal__plan_create before starting them: one task per piece, each with a brief a fresh session can act on and what done looks like, and "after" for a piece that needs another's result first. This session then coordinates the plan, and its row shows it. One plan per session; add to it with mcp__portal__plan_add_tasks. Work you do here yourself, or a single piece, needs no plan.

**Starting the work.** Start one session per task that is free to start (mcp__portal__plan_read lists them), and tell each in its brief: "Claim task T<n> of plan <plan id> with mcp__portal__plan_claim_task first; mark it done with mcp__portal__plan_update_task when finished." A task that waits on another is started only once that one is done; Docket tells you in this chat when tasks become free. Docket does not start sessions for you.

**Working a task.** If your brief names a task, claim it first with mcp__portal__plan_claim_task. If you are told to take the next task, use mcp__portal__plan_next_task. A claim another session already holds is refused: do not work that task, say so in your reply. When finished, set the task to done with a one-line note and links to what you made (a pull request, a file). If you need the user's answer, set waiting_on_user, and set claimed again when you carry on. If you cannot finish it, set it back to open with a note saying why, so another session can take it.

**A plan inside a task.** If the task you hold splits again into pieces for other sessions, make a plan of your own with mcp__portal__plan_create: Docket hangs it off your task and links both ways, so the top plan shows the whole tree's progress. Set your task to done once your own plan is done.

**Checking results.** As coordinator, check each finished task's result before counting it (its session's report, its files, its git branch). If it falls short, set the task to sent_back with a note saying what is missing, and send that session the same with mcp__portal__send_to_session. Read the whole plan any time with mcp__portal__plan_read.

**Tickets are links.** A Jira ticket, GitHub issue or pull request belongs on its task as a link (links on mcp__portal__plan_update_task or in the task when made), one ticket per task. The plan is where tasks are kept and claimed; never keep or claim them in a ticket system as well.
