// How a run works, in Austin's words: the About page's list and the Home page's
// flow chart both read from here, so they can't drift apart.
export const RUN_STEPS: { title: string; body: string }[] = [
  { title: 'Five agents run by one model', body: 'There are five players (1 tank, 1 healer, 3 damage dealers) that are all controlled by the same underlying model.' },
  { title: 'Attempt the dungeon blind', body: 'The agents are not given any information about the enemies, like what abilities they have. They need to rely on their own observations and notes to complete the dungeon.' },
  { title: 'Orders every few seconds', body: 'Every 4 seconds of game time, and right away when something important happens (like a cast starting or an ally dying), each agent sends its orders: where to move, what to cast, and on whom. Asking every 0.1 seconds would cost far too much. The game state waits for their response before progressing, so a slow model is never penalized.' },
  { title: 'Debrief after a failed pull', body: "After every pull that doesn't clear (a wipe or running out of time), the agents can read the combat log, deliberate, and jot down notes. These notes are all they carry into the next pull to help inform their next decisions." },
]
