import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpenFileReceiver, type OpenFileRequest } from './openFiles.ts'

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
const request = (id: number): OpenFileRequest => ({ id, path: `/notes/${id}.md` })

function fixture(initial: OpenFileRequest[] = []) {
  let pending = [...initial]
  const listeners = new Set<() => void>()
  const notify = () => { for (const callback of listeners) callback() }
  let allowed = true
  const opened: number[] = []
  const errors: unknown[] = []
  const receiver = createOpenFileReceiver({
    subscribe: async (callback) => { listeners.add(callback); return () => { listeners.delete(callback) } },
    pending: async () => [...pending],
    open: async ({ id }) => { opened.push(id); if (id === 2) throw new Error('Missing file') },
    acknowledge: async (id) => { pending = pending.filter((item) => item.id !== id) },
    canOpen: () => allowed,
    reportError: async (error) => { errors.push(error) },
  })
  return {
    receiver, opened, errors,
    notify: () => notify(),
    add: (item: OpenFileRequest) => { pending.push(item); notify() },
    pause: () => { allowed = false },
    resume: () => { allowed = true; notify() },
    pending: () => pending,
  }
}

test('files received before startup drain after subscription; bad files do not block later files', async () => {
  const f = fixture([request(1), request(2), request(3)])
  f.receiver.start()
  await tick()
  assert.deepEqual(f.opened, [1, 2, 3])
  assert.equal(f.errors.length, 1)
  assert.deepEqual(f.pending(), [])
  f.receiver.stop()
})

test('overlapping notifications serialize opens and preserve requests arriving during an open', async () => {
  let unblock!: () => void
  const gate = new Promise<void>((resolve) => { unblock = resolve })
  let notify = () => {}
  let pending = [request(1)]
  const events: string[] = []
  const receiver = createOpenFileReceiver({
    subscribe: async (callback) => { notify = callback; return () => {} },
    pending: async () => [...pending],
    open: async ({ id }) => { events.push(`start ${id}`); if (id === 1) await gate; events.push(`end ${id}`) },
    acknowledge: async (id) => { pending = pending.filter((item) => item.id !== id); events.push(`ack ${id}`) },
    canOpen: () => true,
    reportError: async (error) => { throw error },
  })
  receiver.start()
  await tick()
  pending.push(request(3))
  notify()
  notify()
  assert.deepEqual(events, ['start 1'])
  unblock()
  await tick()
  assert.deepEqual(events, ['start 1', 'end 1', 'ack 1', 'start 3', 'end 3', 'ack 3'])
  receiver.stop()
})

test('folder and quit dialogs defer requests without acknowledging or dropping them', async () => {
  const f = fixture([request(1)])
  f.pause()
  f.receiver.start()
  await tick()
  assert.deepEqual(f.opened, [])
  assert.equal(f.pending().length, 1)
  f.resume()
  await tick()
  assert.deepEqual(f.opened, [1])
  f.receiver.stop()
})

test('StrictMode listener replacement cannot consume a startup request twice', async () => {
  const f = fixture([request(1)])
  f.receiver.start()
  f.receiver.stop()
  f.receiver.start()
  await tick()
  assert.deepEqual(f.opened, [1])
  f.add(request(3))
  await tick()
  assert.deepEqual(f.opened, [1, 3])
  f.receiver.stop()
  f.add(request(4))
  await tick()
  assert.deepEqual(f.opened, [1, 3])
})
