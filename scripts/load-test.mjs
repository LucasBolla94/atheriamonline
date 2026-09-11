/**
 * How many people can the city hold?
 *
 * This opens real accounts, real WebSockets and real walking, against whatever
 * address it is pointed at. Nothing here is a simulation of the protocol: it
 * is the protocol.
 *
 *   node scripts/load-test.mjs                       # 50 players, local
 *   PLAYERS=150 URL=https://atheriam.online node scripts/load-test.mjs
 *
 * Every account it makes is called `LoadNNNNNN` and uses an
 * `@loadtest.invalid` address, so they are easy to find and delete afterwards:
 *
 *   scripts/remove-load-test-accounts.sh
 *
 * What it reports:
 *   - how many players got in, and how long the slowest one took;
 *   - the round trip from asking to being told, at the middle and the worst
 *     five per cent. That is the number a player actually feels;
 *   - how much the server sent, so that bandwidth per player is a fact rather
 *     than a hope.
 */
const URL_BASE = process.env.URL ?? 'http://127.0.0.1:3001';
const WORLD_URL =
  process.env.WORLD_URL ??
  (URL_BASE.startsWith('https') ? `${URL_BASE.replace('https', 'wss')}/ws` : 'ws://127.0.0.1:3002');
const PLAYERS = Number(process.env.PLAYERS ?? 50);
const SECONDS = Number(process.env.SECONDS ?? 30);
const PASSWORD = 'correct horse battery staple load';

const stats = {
  joined: 0,
  failedToRegister: 0,
  failedToJoin: 0,
  bytesIn: 0,
  pings: [],
  slowestJoinMs: 0,
};

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return Math.round(sorted[index]);
}

/** Make one account and come back with the cookie and a world ticket. */
async function newPlayer(index) {
  const name = `Load${String(index).padStart(6, '0')}`;
  const register = await fetch(`${URL_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `${name.toLowerCase()}@loadtest.invalid`,
      password: PASSWORD,
      dateOfBirth: '1990-05-04',
      characterName: name,
      confirmsAdult: true,
    }),
  });

  if (!register.ok && register.status !== 409) {
    throw new Error(`register said ${register.status}`);
  }

  let cookie = register.headers.getSetCookie?.()[0]?.split(';')[0];

  // An account that already exists from a previous run is fine: log in.
  if (register.status === 409 || cookie === undefined) {
    const login = await fetch(`${URL_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${name.toLowerCase()}@loadtest.invalid`, password: PASSWORD }),
    });
    if (!login.ok) throw new Error(`login said ${login.status}`);
    cookie = login.headers.getSetCookie?.()[0]?.split(';')[0];
  }
  if (cookie === undefined) throw new Error('no session cookie');

  const ticket = await fetch(`${URL_BASE}/api/world/ticket`, {
    method: 'POST',
    headers: { cookie },
  });
  if (!ticket.ok) throw new Error(`ticket said ${ticket.status}`);
  return (await ticket.json()).ticket;
}

/** One player: join, then walk about and ask the time, until told to stop. */
function playFor(ticket, stopAtMs) {
  return new Promise((resolve) => {
    const socket = new WebSocket(WORLD_URL);
    const startedAtMs = Date.now();
    let joined = false;
    let timer = null;

    const finish = () => {
      if (timer !== null) clearInterval(timer);
      try {
        socket.close();
      } catch {
        // Already gone. Nothing to do.
      }
      resolve();
    };

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ t: 'join', ticket }));
    });

    socket.addEventListener('message', (event) => {
      const raw = String(event.data);
      stats.bytesIn += raw.length;
      const message = JSON.parse(raw);

      if (message.t === 'welcome') {
        joined = true;
        stats.joined += 1;
        stats.slowestJoinMs = Math.max(stats.slowestJoinMs, Date.now() - startedAtMs);

        let seq = 0;
        timer = setInterval(() => {
          if (Date.now() > stopAtMs) {
            finish();
            return;
          }
          seq += 1;
          // Walk somewhere near the square, and time a round trip.
          socket.send(
            JSON.stringify({
              t: 'walkTo',
              seq,
              to: {
                x: 56 + Math.floor(Math.random() * 16),
                y: 56 + Math.floor(Math.random() * 16),
              },
            }),
          );
          socket.send(JSON.stringify({ t: 'ping', ts: Date.now() }));
        }, 1000);
      }

      if (message.t === 'pong') stats.pings.push(Date.now() - message.ts);
      if (message.t === 'bye') finish();
    });

    socket.addEventListener('error', () => {
      if (!joined) stats.failedToJoin += 1;
      finish();
    });

    socket.addEventListener('close', finish);
  });
}

console.log(`Load test: ${PLAYERS} players for ${SECONDS}s against ${WORLD_URL}`);

const tickets = [];
for (let i = 0; i < PLAYERS; i += 1) {
  try {
    tickets.push(await newPlayer(i));
  } catch (error) {
    stats.failedToRegister += 1;
    if (stats.failedToRegister <= 3) console.error(`  could not make a player: ${error.message}`);
  }
}
console.log(`Made ${tickets.length} players. Joining…`);

const stopAtMs = Date.now() + SECONDS * 1000;
await Promise.all(tickets.map((ticket) => playFor(ticket, stopAtMs)));

console.log('');
console.log(`Joined the city:      ${stats.joined} of ${PLAYERS}`);
console.log(`Could not register:   ${stats.failedToRegister}`);
console.log(`Could not join:       ${stats.failedToJoin}`);
console.log(`Slowest join:         ${stats.slowestJoinMs} ms`);
console.log(`Round trip, middle:   ${percentile(stats.pings, 0.5)} ms`);
console.log(`Round trip, worst 5%: ${percentile(stats.pings, 0.95)} ms`);
console.log(`Round trip, worst:    ${percentile(stats.pings, 1)} ms`);
console.log(
  `Sent to players:      ${(stats.bytesIn / 1024 / 1024).toFixed(1)} MB ` +
    `(${Math.round(stats.bytesIn / Math.max(1, stats.joined) / Math.max(1, SECONDS) / 1024)} kB per player per second)`,
);
