import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventLog, dayKey } from '../../src/agent/event-log.js'

/**
 * The daily event log is the durable copy of the Live Events feed: the UI keeps 500 lines and
 * clips each to one row, so anything worth reviewing later has to come from disk. Two properties
 * matter and are tested here: payloads are written WHOLE (a 100 KB tool result stays 100 KB), and
 * one file per local day.
 */

describe('EventLog', () => {
	let dir: string

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vole-events-'))
	})

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	it('writes one JSONL line per event with the payload untruncated', async () => {
		const log = new EventLog(dir)
		const huge = 'y'.repeat(200_000)
		log.append('task:completed', { taskId: 't1', result: huge }, 'nart-sagas')
		log.append('tool:registered', { toolName: 'chat_send', pawName: '@openvole/paw-chat' })
		await log.close()

		const raw = await fs.readFile(log.fileFor(dayKey(new Date())), 'utf-8')
		const lines = raw.split('\n').filter(Boolean)
		expect(lines).toHaveLength(2)

		const first = JSON.parse(lines[0])
		expect(first.event).toBe('task:completed')
		expect(first.agentId).toBe('nart-sagas')
		expect(first.data.result).toHaveLength(200_000)
		expect(typeof first.ts).toBe('number')
		expect(first.time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/)

		// No agent → no agentId key at all (single-engine mode).
		expect(JSON.parse(lines[1]).agentId).toBeUndefined()
	})

	it('appends to an existing day rather than overwriting it', async () => {
		const first = new EventLog(dir)
		first.append('task:queued', { taskId: 'a' })
		await first.close()

		const second = new EventLog(dir)
		second.append('task:queued', { taskId: 'b' })
		await second.close()

		const raw = await fs.readFile(second.fileFor(dayKey(new Date())), 'utf-8')
		expect(raw.split('\n').filter(Boolean)).toHaveLength(2)
	})

	it('reads a day back newest-first and reports what the tail bound left out', async () => {
		const log = new EventLog(dir)
		for (let i = 0; i < 10; i++) log.append('task:queued', { n: i })
		await log.close()

		const day = dayKey(new Date())
		const all = await log.read(day)
		expect(all.total).toBe(10)
		expect(all.dropped).toBe(0)
		expect((all.entries[0].data as { n: number }).n).toBe(9)

		const tail = await log.read(day, 3)
		expect(tail.entries).toHaveLength(3)
		expect(tail.total).toBe(10)
		expect(tail.dropped).toBe(7)
		expect((tail.entries[0].data as { n: number }).n).toBe(9)
		expect((tail.entries[2].data as { n: number }).n).toBe(7)
	})

	it('lists days newest-first and ignores unrelated files', async () => {
		const log = new EventLog(dir)
		await fs.writeFile(path.join(dir, 'events-2026-07-24.jsonl'), '{}\n')
		await fs.writeFile(path.join(dir, 'events-2026-07-26.jsonl'), '{}\n')
		await fs.writeFile(path.join(dir, 'events-2026-07-25.jsonl'), '{}\n')
		await fs.writeFile(path.join(dir, 'vole.log'), 'noise\n')
		await fs.writeFile(path.join(dir, 'events-not-a-day.jsonl'), '{}\n')

		expect(await log.listDays()).toEqual(['2026-07-26', '2026-07-25', '2026-07-24'])
	})

	it('survives a torn final line (killed mid-write)', async () => {
		const log = new EventLog(dir)
		const day = dayKey(new Date())
		await fs.writeFile(
			log.fileFor(day),
			`${JSON.stringify({ ts: 1, time: 'x', event: 'task:queued', data: { n: 1 } })}\n{"ts":2,"eve`,
		)
		const out = await log.read(day)
		expect(out.entries).toHaveLength(1)
		expect(out.entries[0].event).toBe('task:queued')
	})

	it('keeps the event when a payload cannot be serialized', async () => {
		const log = new EventLog(dir)
		const circular: Record<string, unknown> = { name: 'loop' }
		circular.self = circular
		log.append('paw:crashed', circular)
		await log.close()

		const raw = await fs.readFile(log.fileFor(dayKey(new Date())), 'utf-8')
		const entry = JSON.parse(raw.split('\n').filter(Boolean)[0])
		expect(entry.event).toBe('paw:crashed')
		expect(entry.data).toBe('[unserializable]')
	})

	it('prunes days beyond the retention window on rotation, and keeps everything at 0', async () => {
		const old = '2020-01-01'
		const withRetention = new EventLog(dir, { retentionDays: 30 })
		await fs.writeFile(withRetention.fileFor(old), '{}\n')
		withRetention.append('task:queued', { n: 1 })
		await withRetention.close()
		expect(await withRetention.listDays()).not.toContain(old)

		const keepAll = new EventLog(dir, { retentionDays: 0 })
		await fs.writeFile(keepAll.fileFor(old), '{}\n')
		keepAll.append('task:queued', { n: 1 })
		await keepAll.close()
		expect(await keepAll.listDays()).toContain(old)
	})

	it('reads a missing or malformed day as empty instead of throwing', async () => {
		const log = new EventLog(dir)
		expect(await log.read('2019-05-05')).toMatchObject({ entries: [], total: 0 })
		expect(await log.read('../../etc/passwd')).toMatchObject({ entries: [], total: 0 })
	})

	it('never throws when the log directory cannot be created', async () => {
		const blocked = path.join(dir, 'file-not-a-dir')
		await fs.writeFile(blocked, 'x')
		const log = new EventLog(path.join(blocked, 'logs'))
		log.append('task:queued', { n: 1 })
		await expect(log.close()).resolves.toBeUndefined()
	})
})

describe('dayKey', () => {
	it('uses the local date so a file boundary matches the operator midnight', () => {
		// 23:30 local on the 26th stays on the 26th regardless of the UTC offset.
		const d = new Date(2026, 6, 26, 23, 30, 0)
		expect(dayKey(d)).toBe('2026-07-26')
		expect(dayKey(new Date(2026, 0, 5, 0, 5, 0))).toBe('2026-01-05')
	})
})
