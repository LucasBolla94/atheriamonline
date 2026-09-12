# Atheriam — Open Questions

Questions for the **owner**. Work does not stop while these wait: for each one
there is an assumption in use right now, written under "Working assumption".
When you answer, the answer moves to `docs/SPEC.md` and the question is deleted
from this file.

---

## Q-001 — Has anybody played it on a real phone yet?

The game is built and tested for a phone in landscape, and the browser tests
run at phone size on every change. But this machine has no GPU, so no test
here can honestly say the game holds 60 frames a second on a real mid-range
phone — see D-035.
**Working assumption:** it is fast enough. The client draws each piece of
ground once rather than every frame, and never does more than one piece per
frame, which is what the target asks for.
**What we need from you:** open https://atheriam.online on your phone,
sideways, walk around for a minute, and say whether it feels smooth.

## Q-002 — How do players pay, if at all?

The spec forbids blockchain and loot boxes, but does not say how the game earns
money.
**Working assumption:** no payments at all for now. Nothing in the code assumes
a shop.
**What we need from you:** subscription, cosmetic shop, or free for now?

## Q-003 — How big should the starter city be?

**Working assumption:** one district of roughly 128 x 128 tiles, enough for a
few hundred players to feel busy.
**What we need from you:** is a single district enough for launch?

## Q-010 — Should a house be somewhere in the city, or only a button?

Today "Go home" is a button, and calling on somebody is another one. There is
no door in the street that leads to a particular person's house — see D-053
for why: there are six houses drawn in the residential quarter and there will
be thousands of players.
**Working assumption:** buttons are enough, and the city stays a place people
meet rather than a street of front doors.
**What we need from you:** whether you want a district where houses really do
belong to particular players, which is a much bigger city and a way to buy or
be given a plot.

## Q-011 — Should "welcomed" become a real friends list?

A house door is open to nobody, to the people on a list the owner keeps, or to
anybody. The list is one-way: you can welcome somebody without their knowing.
**Working assumption:** a one-way list is enough, and friendship is a separate
feature nobody has asked for yet — see D-054.
**What we need from you:** whether players should be able to be friends with
each other properly, and what else that would change (seeing who is online,
finding each other in the city, and so on).

## Q-004 — What happens to a player who is offline for a long time?

**Working assumption:** nothing. The character and house stay forever.
**What we need from you:** should old accounts or houses expire?

## Q-005 — Who are the first moderators?

Moderator rights exist on the account, and `pnpm db:seed` can grant them to
one account you name.
**Working assumption:** only the owner's account has them.
**What we need from you:** a list of accounts that should be moderators, when
you have one.

## Q-006 — What should happen when the city is full?

The server refuses player 201 with "The city is full right now."
**Working assumption:** 200 players in one world server, and no queue.
**What we need from you:** is a queue worth building, or should a second
district open instead?

## Q-007 — Can a player change their name?

A name now belongs to an account permanently: it is registered once and nobody
else can take it.
**Working assumption:** names cannot be changed.
**What we need from you:** should a player be able to rename themselves, and
if so, does the old name become free again?

## Q-009 — How long should a login last?

A session currently lasts seven days from the last time it was used.
**Working assumption:** seven days.
**What we need from you:** confirm, or name a different period.
