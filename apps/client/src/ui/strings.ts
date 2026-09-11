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
    desktop: 'Click a tile to walk there, or use WASD.',
    touch: 'Tap a tile to walk there.',
  },
} as const;

/** Turn any reason the connection gives us into a sentence for the player. */
export function errorMessage(reason: string): string {
  return strings.errors[reason] ?? strings.errors['unknown'] ?? reason;
}
