Real-user stress scenarios: 13/13 as intended, $0.1024 total (local guard $1); zone Asia/Kolkata, today 2026-11-18.

### PASS A1 (truth) Add, then 'wait did you actually do that?' — $0.0018
- state: 1 "lab report" task(s); 2nd reply confirms
- > add bio lab report due friday
  - tools: create_task
  - reply: Added "Bio lab report," due Friday (Nov 20), not a hard deadline. It isn't scheduled to a specific time yet.
- > wait did you actually do that?
  - tools: none
  - reply: Yes, it's really there: "Bio lab report" is on your task list, due Friday, not a hard deadline. It's a single task, not a duplicate.

### PASS A2 (truth) Delete something that doesn't exist — $0.001
- state: math todo; 1 task(s); no false deletion claim
- > delete my french essay
  - tools: none
  - reply: I couldn't find a French essay anywhere in your tasks, projects, notes or inbox, so I haven't deleted anything. The only open task I see is "Math problem set 7". Could you check the name, or tell me where it lives?

### PASS B1 (planner) 'I only have like 30 min today' — $0.0585
- state: 1 block(s), 20 min planned today
- > I only have like 30 min today, plan it
  - tools: plan
  - reply: I fit in Spanish vocab, since it's the one task that fits in your 30 minutes. It's on My day. Physics reading and the English essay draft are still on your list but didn't fit today. I assumed you're free this morning. Is that right?

### PASS B2 (planner) 'make room for chem but don't touch my other stuff' — $0.0014
- state: own blocks untouched; chem at 09:50
- > make room for chem today but don't touch my other stuff
  - tools: update_item, update_item, plan
  - reply: Chem lab prep is on today's plan for this morning, and I left your Robotics notes and History reading exactly where they were. I assumed you're free this morning; is that right?

### PASS B3 (planner) 'put this after school unless I have something' (after-school event) — $0.002
- state: revisions at 16:30–17:15
- > I need to do my lab report revisions today
  - tools: plan
  - reply: Lab report revisions are on your plan for this morning, before your 3:30 dentist appointment. I assumed you're free from about 9:50 to 10:35 this morning; tell me if that's wrong and I'll move it.
- > put this after school unless I have something
  - tools: move_block
  - reply: I moved lab report revisions to 4:30 PM, right after your dentist appointment. I don't have your school hours, so if school ends later than that, tell me the time and I'll shift it.

### PASS C1 (nlu) 'bro move that thing to tomorrow' — $0.0129
- state: spanish: kept off until tomorrow, task todo
- > whats on my plan today
  - tools: none
  - reply: You have one thing today: Spanish oral practice at 4:00 PM for 30 minutes. The rest of the day is open.
- > bro move that thing to tomorrow
  - tools: keep_off_until
  - reply: Done. Spanish oral practice is off today and won't be planned before tomorrow, so it's no longer on your plan for today.

### PASS C2 (nlu) 'nah not that one, the other assignment' — $0.0017
- state: bio: kept off until tomorrow; chem: back on today
- > push the chem worksheet to tomorrow
  - tools: keep_off_until
  - reply: The Chem worksheet is off today and kept for tomorrow, Thursday. I've assumed you're free this morning, so tell me if that's wrong.
- > nah not that one, the other assignment
  - tools: keep_off_until, keep_off_until
  - reply: I've moved the Bio worksheet to tomorrow, Thursday, and put the Chem worksheet back to normal. I assumed you're free this morning, so tell me if that's wrong.

### PASS C3 (nlu) 'actually forget what I just said' — $0.0018
- state: 0 open "grandma" task(s)
- > add a task to call grandma tonight
  - tools: create_task
  - reply: I've added "Call grandma" as a task for tonight, with a soft due time of 9 PM (not a hard deadline). I picked 9 PM as a sensible time for "tonight," so tell me if you meant a different hour.
- > actually forget what I just said
  - tools: delete_item
  - reply: I've removed the "Call grandma" task.

### PASS C4 (nlu) 'I finished those already' — $0.0016
- state: gatsby ch5 done, quiz done, science fair todo
- > what's due in the next couple days?
  - tools: none
  - reply: Two things are due Friday, both hard deadlines at 11:59 PM: the Gatsby reading quiz (about 15 minutes) and Read Gatsby ch. 5 (about 30 minutes). Nothing is due today or tomorrow.
- > I finished those already
  - tools: complete_task, complete_task
  - reply: Nice work. I've marked both Gatsby tasks done. The science fair board is still open, with no due date.

### PASS C5 (nlu) 'why is this back on my schedule?' (read-only question) — $0.0137
- state: block today 1, task todo; nothing changed (a question)
- > why is lit annotations back on my schedule?
  - tools: none
  - reply: I can't see a record of why it came back. The activity log is empty, and there's no sign you removed or finished it earlier. "Lit annotations" is an open task that was added just now, with no due date and about 30 minutes of work. The planner put it on this afternoon because that time was free. If you don't want it today, I can move it to another day or keep it off until a day you pick. If you meant to drop it altogether, I can cancel it. Which do you want?

### PASS D1 (continuity) Three turns refining one piece of work — $0.004
- state: 1 chem task(s), 1 block(s) today at 19:00 for 45 min
- > I have a chem test on friday, add 1 hour of study time today
  - tools: create_task, plan
  - reply: I added a one-hour "Chem test study" task, due Friday (not a hard deadline), and it's on your plan for this morning. I assumed you're free until about 10:50 AM; tell me if that's wrong and I'll move it.
- > make it 45 min instead
  - tools: update_task, plan_day✗, plan_day
  - reply: Done, the Chem test study is now 45 minutes and sits on today's plan in the morning. I assumed you're free from about 9:50 AM to 10:35 AM; let me know if that's off.
- > actually put it at 7pm
  - tools: move_block
  - reply: Moved your Chem test study to 7 PM today, and it's pinned there so re-plans won't shift it.

### PASS E1 (integration) 'what do I have today?' with 30 overdue Canvas items — $0.0009
- state: 30/30 imported still open (no silent changes); 0 block(s); doesn't call the backlog 'due today'
- > what do I have today?
  - tools: none
  - reply: Nothing is scheduled for today: no events, routines or plan blocks. Your only open task is the PBL presentation slides, about an hour, which I can put on your day if you'd like.

### PASS E2 (integration) 'I handed all the old canvas stuff in' — $0.001
- state: 0 imported still open; own PBL task kept
- > I handed all the old canvas stuff in already
  - tools: resolve_overdue_imports
  - reply: All 25 of the old Chem 101 worksheets from Canvas are now marked done as handed in. Nothing overdue is waiting on you.

