import {
	readConfigFile,
	readIdentityFiles,
	writeConfigFile,
	writeIdentityFile,
} from '../config/index.js'
import type { BusEvents } from '../core/bus.js'
import type { VoleEngine } from '../index.js'

/** Bus events forwarded to the control plane (mirrors the dashboard's subscriptions). */
const FORWARDED_EVENTS: Array<keyof BusEvents> = [
	'tool:registered',
	'tool:unregistered',
	'paw:registered',
	'paw:unregistered',
	'paw:crashed',
	'task:queued',
	'task:started',
	'task:completed',
	'task:failed',
	'task:cancelled',
	'rate:limited',
	'volenet:tool:executed',
]

/** Aggregate engine state for the dashboard (shape matches PawRegistry.handleQuery). */
function gatherState(engine: VoleEngine): Record<string, unknown> {
	return {
		tools: engine.toolRegistry.list().map((t) => ({
			name: t.name,
			description: t.description,
			pawName: t.pawName,
			inProcess: t.inProcess,
		})),
		paws: engine.pawRegistry.list().map((p) => ({
			name: p.name,
			healthy: p.healthy,
			inProcess: p.inProcess,
			transport: p.transport,
			category: p.manifest?.category ?? 'tool',
			toolCount: engine.toolRegistry.toolsForPaw(p.name).length,
			panel: p.manifest?.panel?.title ?? null,
		})),
		skills: engine.skillRegistry.list().map((s) => ({
			name: s.name,
			active: s.active,
			missingTools: s.missingTools,
			description: s.definition.description,
		})),
		tasks: engine.taskQueue.list().map((t) => {
			const task = t as unknown as Record<string, unknown>
			return {
				id: t.id,
				source: t.source,
				input: t.input,
				status: t.status,
				createdAt: t.createdAt,
				startedAt: task.startedAt,
				completedAt: task.completedAt,
				priority: task.priority,
				metadata: task.metadata
					? { cost: (task.metadata as Record<string, unknown>).cost }
					: undefined,
			}
		}),
		schedules: engine.scheduler.list(),
		volenet: { enabled: false },
	}
}

function brainPawName(engine: VoleEngine): string | undefined {
	return engine.config.brain
		? engine.pawRegistry.resolveManifestName(engine.config.brain)
		: undefined
}

export interface ControlAdapter {
	/** Point the adapter at a freshly-created engine (after an in-process restart). */
	rebind(engine: VoleEngine): void
}

/**
 * Bridge a space-engine to its control-plane parent over the Node IPC channel: answers
 * `{id,method,params}` requests via direct engine calls and forwards bus events as
 * `{event,data}` notifications. Only meaningful when spawned with an IPC channel.
 */
export function installControlAdapter(engine: VoleEngine, projectRoot: string): ControlAdapter {
	const send = (msg: unknown): void => {
		process.send?.(msg)
	}

	let current = engine
	let unbindBus: () => void = () => {}

	const bindBus = (eng: VoleEngine): void => {
		unbindBus()
		const offs = FORWARDED_EVENTS.map((event) => {
			const handler = (data: unknown): void => send({ event, data })
			eng.bus.on(event, handler as never)
			return () => eng.bus.off(event, handler as never)
		})
		unbindBus = () => {
			for (const off of offs) off()
		}
	}

	process.on('message', async (msg: unknown) => {
		const req = msg as { id?: number; method?: string; params?: Record<string, unknown> }
		if (req == null || req.id === undefined || !req.method) return
		const { id, method, params = {} } = req
		try {
			let result: unknown
			switch (method) {
				case 'state':
					result = gatherState(current)
					break
				case 'read_config':
					result = await readConfigFile(projectRoot)
					break
				case 'write_config': {
					const onDisk = await readConfigFile(projectRoot)
					if (onDisk.demo === true) {
						throw new Error(
							'This space is in demo mode — configuration is read-only from the dashboard. Edit vole.config.json on the server to change it.',
						)
					}
					await writeConfigFile(projectRoot, params.config as Record<string, unknown>)
					result = { ok: true }
					break
				}
				case 'read_identity':
					result = await readIdentityFiles(projectRoot, brainPawName(current))
					break
				case 'write_identity': {
					const onDisk = await readConfigFile(projectRoot)
					if (onDisk.demo === true) {
						throw new Error(
							'This space is in demo mode — identity files are read-only from the dashboard.',
						)
					}
					result = await writeIdentityFile(
						projectRoot,
						params.filename as string,
						params.content as string,
						brainPawName(current),
					)
					break
				}
				case 'submit':
					result = {
						ok: true,
						taskId: current.run(
							params.input as string,
							'user',
							params.sessionId as string | undefined,
						),
					}
					break
				case 'chat_history': {
					// History comes from paw-session's tool (if loaded) — no file-format coupling.
					const tool = current.toolRegistry.get('session_history')
					result = tool
						? await tool.execute({ sessionId: params.sessionId, maxMessages: 500 })
						: { ok: false, history: '' }
					break
				}
				case 'chat_sessions': {
					const tool = current.toolRegistry.get('session_list')
					result = tool ? await tool.execute({}) : { ok: false, sessions: [] }
					break
				}
				case 'chat_clear': {
					const tool = current.toolRegistry.get('session_clear')
					result = tool
						? await tool.execute({ sessionId: params.sessionId })
						: { ok: false, error: 'paw-session is not loaded in this space' }
					break
				}
				case 'panel_html': {
					const html = await current.pawRegistry.getPanelHtml(params.paw as string)
					result = { html }
					break
				}
				case 'tool': {
					const t = current.toolRegistry.get(params.name as string)
					result = t
						? await t.execute((params.params as Record<string, unknown>) ?? {})
						: { error: `tool not found: ${params.name}` }
					break
				}
				case 'restart':
					current.bus.emit('engine:restart' as never, {} as never)
					result = { ok: true }
					break
				default:
					throw new Error(`Unknown control method: ${method}`)
			}
			send({ id, result })
		} catch (err) {
			send({ id, error: err instanceof Error ? err.message : String(err) })
		}
	})

	bindBus(engine)
	send({ ready: true })
	return {
		rebind: (eng: VoleEngine): void => {
			current = eng
			bindBus(eng)
		},
	}
}
