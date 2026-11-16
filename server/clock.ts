/** The server's clock, replaceable in tests so windows and bans can be stepped through. */
export const clock = { now: (): number => Date.now() }
