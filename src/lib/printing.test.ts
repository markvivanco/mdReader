import assert from 'node:assert/strict'
import test from 'node:test'
import { printInWebview } from './printing.ts'

class PrintWindow extends EventTarget {
  print() { this.dispatchEvent(new Event('beforeprint')) }
}

test('the print snapshot remains mounted until print or cancel emits afterprint', async () => {
  const target = new PrintWindow()
  let finished = false
  const printing = printInWebview(target).then(() => { finished = true })
  await Promise.resolve()
  assert.equal(finished, false)
  target.dispatchEvent(new Event('afterprint'))
  await printing
  assert.equal(finished, true)
  // A second print should not inherit the old listeners.
  const second = printInWebview(target)
  target.dispatchEvent(new Event('afterprint'))
  await second
})

test('print failures and missing print support reject without leaving a pending operation', async () => {
  const target = new PrintWindow()
  target.print = () => { throw new Error('printer unavailable') }
  await assert.rejects(printInWebview(target), /printer unavailable/)
  target.print = () => {}
  await assert.rejects(printInWebview(target, 1), /print dialog did not open/)
})
