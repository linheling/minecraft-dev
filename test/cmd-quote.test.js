/**
 * The shared cmd.exe quoting rule: one plain quote pair, never a backslash
 * escape. The regression this locks is the Codex paths rewriting `"` to `\"`
 * — a form cmd.exe does not parse under `/d /s /c` with the verbatim argv the
 * package already spawns with.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { cmdShimArgv, quoteCmdArg } from '../lib/cmd-quote.js'

test('quoteCmdArg wraps a token in exactly one plain quote pair', () => {
  assert.equal(quoteCmdArg('build'), '"build"')
  assert.equal(quoteCmdArg('C:\\work\\my plugin'), '"C:\\work\\my plugin"')
  // Backslashes are passed through, never doubled: cmd.exe reads the token
  // verbatim, and a `\\"` sequence would close the quote early.
  assert.equal(quoteCmdArg('C:\\a\\b'), '"C:\\a\\b"')
  assert.equal(quoteCmdArg(42), '"42"')
})

test('quoteCmdArg rejects an embedded quote instead of escaping it', () => {
  assert.throws(
    () => quoteCmdArg('a"b', 'codex argument'),
    /codex argument cannot be passed to cmd\.exe: it contains a double quote/,
  )
  assert.throws(() => quoteCmdArg('a"b'), /has no escaped-quote form/)
  // The refused value is echoed verbatim so the operator can see it.
  assert.throws(() => quoteCmdArg('a"b'), /"a\\"b"/)
})

test('quoteCmdArg rejects control characters that would end the command line', () => {
  for (const value of ['a\nb', 'a\rb', 'a\u0000b']) {
    assert.throws(() => quoteCmdArg(value), /cannot be passed to cmd\.exe: it contains a control character/)
  }
})

test('cmdShimArgv runs an already-quoted command through cmd.exe /d /s /c', () => {
  assert.deepEqual(
    cmdShimArgv('"C:\\proj\\gradlew.bat" build'),
    ['cmd.exe', '/d', '/s', '/c', '""C:\\proj\\gradlew.bat" build"'],
  )
  assert.deepEqual(cmdShimArgv('prog arg'), ['cmd.exe', '/d', '/s', '/c', '"prog arg"'])
})
