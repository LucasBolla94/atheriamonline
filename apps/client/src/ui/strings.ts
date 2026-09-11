/**
 * Every word the player reads, in one place.
 *
 * The product is in English (`docs/SPEC.md` section 1). Keeping the text here
 * rather than inside components means it can be translated later without
 * touching a single component, and it means nobody has to hunt through the
 * interface to fix a typo.
 */
export const strings = {
  appName: 'Atheriam',
  tagline: 'A city that only exists while people are in it.',

  auth: {
    createTab: 'Create an account',
    loginTab: 'Log in',

    nameLabel: 'Your name in the city',
    namePlaceholder: 'Aldric',
    nameHelp: 'Three to twenty letters or numbers. Spaces are fine.',

    emailLabel: 'Email address',
    emailPlaceholder: 'you@example.com',

    passwordLabel: 'Password',
    passwordHelp: 'At least ten characters. Longer is better than complicated.',

    birthdayLabel: 'Date of birth',
    birthdayHelp: 'We ask because Atheriam is for adults only.',

    adultLabel: 'I confirm that I am 18 or over.',

    createSubmit: 'Create my account',
    loginSubmit: 'Enter the city',
    working: 'One moment…',

    ageNotice: 'Atheriam is for adults. You must be 18 or over to play.',
    logOut: 'Log out',
  },

  errors: {
    nameTooShort: 'That name is too short — three letters at least.',
    nameTooLong: 'That name is too long — twenty letters at most.',
    nameBadCharacters: 'Please use only letters, numbers, spaces, - and _.',
    passwordTooShort: 'Your password must be at least ten characters.',
    notAnEmail: 'That does not look like an email address.',
    noBirthday: 'Please tell us your date of birth.',
    notConfirmedAdult: 'Please confirm that you are 18 or over.',
    'bad-ticket': 'Your pass to the city expired. Please try again.',
    'already-online': 'That character is already in the city.',
    'server-full': 'The city is full right now. Please try again in a moment.',
    kicked: 'A moderator removed you from the city.',
    banned: 'This account is banned from Atheriam.',
    shutdown: 'The city is restarting. Come back shortly.',
    'protocol-error': 'The connection sent something unexpected and was closed.',
    idle: 'You were away for a long time, so you left the city.',
    'could not reach the world': 'Could not reach the city. Is the world server running?',
    'connection lost': 'The connection dropped.',
    'you left': 'You left the city.',
    unknown: 'Something went wrong. Please try again.',
  } as Record<string, string>,

  hud: {
    connecting: 'Connecting…',
    joining: 'Entering the city…',
    playersNearby: (count: number): string =>
      count === 1 ? '1 person nearby' : `${count} people nearby`,
    position: (x: number, y: number): string => `${x}, ${y}`,
  },

  hints: {
    desktop: 'Click a tile to walk there, WASD to step, Enter to talk.',
    touch: 'Tap a tile to walk there. Use the box below to talk.',
  },

  chat: {
    logLabel: 'What people near you are saying',
    inputLabel: 'Say something',
    placeholder: 'Say something to the people near you…',
    send: 'Say',
    empty: 'Nobody nearby has said anything yet.',
    nameTitle: (name: string): string => `What to do about ${name}`,
    muted: 'A moderator has stopped you talking for now.',
    hide: 'Hide chat',
    show: (unread: number, more: boolean): string =>
      unread === 0 ? 'Show chat' : `Show chat (${unread}${more ? '+' : ''})`,
    tooChatty: 'That was a lot at once. Give it a moment.',
  },

  pouch: {
    title: 'Your purse',
    open: 'Purse',
    loading: '…',
    claimDaily: "Collect today's reward",
    claimed: (amount: string): string => `You collected ${amount}.`,
    alreadyClaimed: 'You have already collected today. Come back tomorrow.',
    carrying: (count: number): string =>
      count === 1 ? 'You are carrying 1 thing' : `You are carrying ${count} things`,
    empty: 'Your hands are empty.',
    recently: 'Recently',
    close: 'Close',
  },

  trade: {
    title: (name: string): string => `Trading with ${name}`,
    explain:
      'Everything you put on the table leaves your hands straight away. Nothing is swapped until you both agree, and changing anything means agreeing again.',
    yours: 'What you are giving',
    theirs: (name: string): string => `What ${name} is giving`,
    nothingYet: 'Nothing yet.',
    putOn: 'Your things',
    put: 'put on the table',
    takeBack: 'take back',
    moneyLabel: 'Crowns to put on the table',
    moneyPlaceholder: '0.00',
    setMoney: 'Set',
    purse: (amount: string): string => `You have ${amount} left in your purse.`,
    agree: 'I agree to this',
    waiting: 'Waiting for them…',
    youAgreed: 'You have agreed.',
    youHaveNot: 'You have not agreed yet.',
    theyAgreed: (name: string): string => `${name} has agreed.`,
    theyHaveNot: (name: string): string => `${name} has not agreed yet.`,
    callOff: 'Call it off',
    done: 'The trade is done.',
    ended: 'The trade ended.',
    offer: 'Offer to trade',
  },

  safety: {
    title: (name: string): string => `What to do about ${name}`,
    subtitle: 'Blocking is private. Reporting goes to a moderator.',
    block: 'Stop hearing this person',
    unblock: 'Hear this person again',
    blockHelp: 'You will not see anything they say. They are not told.',
    unblockHelp: 'You will hear them again from now on.',
    report: 'Report them to a moderator',
    reportHelp: 'A person reads every report. Reporting does not silence anybody by itself.',
    reasonLabel: 'What happened?',
    sendReport: 'Send the report',
    reportSent: 'Thank you. A moderator will read this.',
    blocked: (name: string): string => `You will no longer hear ${name}.`,
    unblocked: (name: string): string => `You will hear ${name} again.`,
    close: 'Close',
  },
} as const;

/** Turn any reason the connection gives us into a sentence for the player. */
export function errorMessage(reason: string): string {
  return strings.errors[reason] ?? strings.errors['unknown'] ?? reason;
}
