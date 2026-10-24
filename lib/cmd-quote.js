/**
 * The one cmd.exe quoting rule for this package's win32 command lines.
 *
 * Three call sites (gradlew, `codex exec`, `codex app-server`) each carried
 * their own copy of "wrap the token in double quotes", and the two Codex copies
 * also escaped an embedded quote to `\"`. That form belongs to node's ordinary
 * Windows argv quoting; under `cmd.exe /d /s /c "<command>"` with
 * `windowsVerbatimArguments: true` the argv reaches cmd verbatim, and cmd.exe
 * has no in-band escape — the package's own gradle test calls the `\"` rewrite
 * an injection vector. A value cmd cannot represent is therefore REJECTED,
 * never rewritten, so every caller fails loudly instead of running a subtly
 * different command line.
 * @module minecraft-dev/lib/cmd-quote
 */

/** CR/LF end the command line; NUL cannot cross the process boundary. */
const UNSAFE_CONTROL = /[\u0000\r\n]/

/**
 * Quote one argv token for a cmd.exe command line.
 *
 * The token becomes the value wrapped in one plain `"..."` pair. cmd.exe honours
 * double quotes around a whole token and nothing inside them needs a backslash
 * escape. The Windows caveat this helper does NOT address is `%NAME%`
 * expansion, which cmd.exe still performs inside double quotes; `gradle.js`
 * rejects that class for its own arguments, while the Codex paths pass
 * filesystem paths and flags where a literal `%` pair is a pre-existing hazard
 * rather than something quoting can fix.
 * @param {string|number} value - the argv token to quote.
 * @param {string} [label] - what the value is, used in the error message.
 * @returns {string} the quoted token.
 * @throws {Error} when the value contains `"`, CR, LF or NUL — the four cases
 *   cmd.exe cannot take without an escape it does not understand.
 */
export function quoteCmdArg(value, label = 'argument') {
  const text = String(value)
  if (text.includes('"')) {
    throw new Error(
      `${label} cannot be passed to cmd.exe: it contains a double quote, and cmd.exe has no escaped-quote form (${JSON.stringify(text)})`,
    )
  }
  if (UNSAFE_CONTROL.test(text)) {
    throw new Error(
      `${label} cannot be passed to cmd.exe: it contains a control character (${JSON.stringify(text)})`,
    )
  }
  return `"${text}"`
}

/**
 * Wrap one already-quoted cmd.exe command line in the argv that runs it.
 *
 * `/s` tells cmd to strip only the first and last quote of the command string,
 * so the outer pair added here is consumed and the inner quoting survives
 * intact — the shape both gradlew and the Codex paths spawn.
 * @param {string} command - a command line whose every token is already quoted
 *   (or is a known-safe bare token such as `exec` or `app-server`).
 * @returns {string[]} the spawn argv, to be run with `windowsVerbatimArguments`.
 */
export function cmdShimArgv(command) {
  return ['cmd.exe', '/d', '/s', '/c', `"${command}"`]
}
