# Atheriam — Open Questions

Questions for the **owner**. Work does not stop while these wait: for each one
there is an assumption in use right now, written under "Working assumption".
When you answer, the answer moves to `docs/SPEC.md` and the question is deleted
from this file.

---

## Q-001 — Is Docker available on the server?

Docker is not installed on this machine, so PostgreSQL and Redis cannot be
started locally yet.
**Working assumption:** Docker will be installed later, and until then the parts
that need a database are postponed (they are not needed before Phase 2).
**What we need from you:** may we install Docker on this machine, or do you want
to use a hosted PostgreSQL and Redis instead?

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

## Q-004 — What happens to a player who is offline for a long time?

**Working assumption:** nothing. The character and house stay forever.
**What we need from you:** should old accounts or houses expire?

## Q-005 — Who are the first moderators?

**Working assumption:** only the owner's account has moderator rights.
**What we need from you:** a list of accounts that should be moderators, when
you have one.
