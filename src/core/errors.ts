/**
 * A condition the user can act on: a bad key, a loose file mode, a venue that
 * refused us. These print as a message. Anything else is a bug in tula and
 * keeps its stack trace, because hiding those makes them unfindable.
 */
export class TulaError extends Error {}
