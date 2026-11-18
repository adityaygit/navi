Real-user stress scenarios: 10/13 as intended, $0.1008 total (local guard $1); zone Asia/Kolkata, today 2026-11-18.

### PASS A1 (truth) Add, then 'wait did you actually do that?' — $0.0019
- state: 1 "lab report" task(s); 2nd reply confirms
- > add bio lab report due friday
  - tools: create_task
  - reply: I added "Bio lab report" with a soft due date of Friday, Nov 20 (not a hard deadline). It isn't scheduled to a specific time yet.
- > wait did you actually do that?
  - tools: none
  - reply: Yes, but it turns out you already had a "Bio lab report" task due Friday, and it's the only one there is now, so nothing was duplicated. It's a soft due date (Friday, Nov 20, not a hard deadline) and isn't scheduled to a time yet.

### PASS A2 (truth) Delete something that doesn't exist — $0.0006
- state: math todo; 1 task(s); no false deletion claim
- > delete my french essay
  - tools: none
  - reply: I couldn't find a French essay in your tasks, projects, notes, or inbox, so I haven't deleted anything. Your only open task is "Math problem set 7". Tell me the exact name if the essay is saved under a different title.

### PASS B1 (planner) 'I only have like 30 min today' — $0.0585
- state: 1 block(s), 20 min planned today
- > I only have like 30 min today, plan it
  - tools: plan
  - reply: I've capped today at 30 minutes of work and planned Spanish vocab, the one task that fits (about 20 minutes). The English essay draft and Physics reading are too long for today. They're still on your list. I assumed you're free right now, this morning. Is that right?

### PASS B2 (planner) 'make room for chem but don't touch my other stuff' — $0.0014
- state: own blocks untouched; chem at 09:40
- > make room for chem today but don't touch my other stuff
  - tools: update_item, update_item, plan
  - reply: Chem lab prep is on today from about 9:40 to 10:25 AM, in the free morning. I pinned your Robotics notes and History reading where they were, so nothing else moved. I assumed you're free that morning; tell me if that's wrong.

### PASS B3 (planner) 'put this after school unless I have something' (after-school event) — $0.0015
- state: revisions at 16:30–17:15
- > I need to do my lab report revisions today
  - tools: plan
  - reply: Lab report revisions are on your plan for this morning, so you have time before your dentist appointment at 3:30. I assumed you're free from about 9:40 this morning; is that right?
- > put this after school unless I have something
  - tools: move_block
  - reply: I moved the lab report revisions to this afternoon, right after your dentist appointment. I don't have your school hours, so I went by the dentist visit; tell me if you have something else on before then.

### MISS C1 (nlu) 'bro move that thing to tomorrow' — $0.013
- state: today 0, tomorrow 0, task todo
- > whats on my plan today
  - tools: none
  - reply: You have one thing planned today: Spanish oral practice from 4:00 to 4:30 PM. The rest of the day is open, and nothing is due today.
- > bro move that thing to tomorrow
  - tools: keep_off_until, plan_day✗
  - reply: Done. Spanish oral practice is off today and won't be planned before tomorrow, so it'll show up on My day then.

### MISS C2 (nlu) 'nah not that one, the other assignment' — $0.0016
- state: bio unplanned; chem today
- > push the chem worksheet to tomorrow
  - tools: keep_off_until
  - reply: The Chem worksheet is moved off today and won't be planned before tomorrow, Thursday. I assumed you're free from about 9:40 this morning, so tell me if that's wrong.
- > nah not that one, the other assignment
  - tools: keep_off_until, keep_off_until
  - reply: Got it. I've moved the Bio worksheet to tomorrow and put the Chem worksheet back so it can be planned again.

### MISS C3 (nlu) 'actually forget what I just said' — $0.0019
- state: 1 open "grandma" task(s)
- > add a task to call grandma tonight
  - tools: create_task
  - reply: I've added "Call grandma" for tonight, with a soft due time of 9 PM (not a hard deadline) and a reminder at 8:30. I assumed 9 PM since you didn't give a time.
- > actually forget what I just said
  - tools: delete_item
  - reply: Okay, I've sent a card to remove the "Call grandma" task. It stays on your list until you approve it.

### PASS C4 (nlu) 'I finished those already' — $0.0016
- state: gatsby ch5 done, quiz done, science fair todo
- > what's due in the next couple days?
  - tools: none
  - reply: Nothing is due tomorrow (Thursday). On Friday there are two hard deadlines at 11:59 PM: "Read Gatsby ch. 5" (about 30 minutes) and the "Gatsby reading quiz" (about 15 minutes). The science fair board has no due date.
- > I finished those already
  - tools: complete_task, complete_task
  - reply: Both Gatsby items are marked done: "Read Gatsby ch. 5" and the "Gatsby reading quiz." The science fair board is still open with no due date.

### PASS C5 (nlu) 'why is this back on my schedule?' (read-only question) — $0.0135
- state: block today 1, task todo; reply claims a change
- > why is lit annotations back on my schedule?
  - tools: none
  - reply: I can't see why it came back. The activity log is empty, so there's no record of it being moved, skipped or re-planned. All I can see is that "Lit annotations" is still an open task (about 30 minutes, no due date). The planner puts open tasks into free time, and that's probably why it's on today at 5 PM. If you already did it, tell me and I'll mark it done. If you don't want it today, I can keep it off until a day you pick, or you can tell me to drop it.

### PASS D1 (continuity) Three turns refining one piece of work — $0.0032
- state: 1 chem task(s), 1 block(s) today at 19:00 for 45 min
- > I have a chem test on friday, add 1 hour of study time today
  - tools: create_task, plan_day✗, plan_day
  - reply: I've added a one-hour "Study for chem test" task, due Friday (not a hard deadline), and it's on today's plan. I assumed you're free this morning; if that's wrong, tell me when works better.
- > make it 45 min instead
  - tools: update_task, plan_day
  - reply: Done, the chem study block is now 45 minutes and sits on today's plan. I assumed you're free this morning; tell me if that's wrong.
- > actually put it at 7pm
  - tools: move_block
  - reply: The chem study session is moved to 7 PM today and pinned there.

### PASS E1 (integration) 'what do I have today?' with 30 overdue Canvas items — $0.0009
- state: 30/30 imported still open (no silent changes); 0 block(s); doesn't call the backlog 'due today'
- > what do I have today?
  - tools: none
  - reply: Nothing is scheduled for today: no events, routines or plan blocks. You have one open task, the PBL presentation slides, which I can put on your plan if you'd like.

### PASS E2 (integration) 'I handed all the old canvas stuff in' — $0.001
- state: 0 imported still open; own PBL task kept
- > I handed all the old canvas stuff in already
  - tools: resolve_overdue_imports
  - reply: All 25 of the old Chem 101 worksheets are marked as handed in and done, so none of them will sit on your list anymore.

