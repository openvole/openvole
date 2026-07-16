import { describe, expect, it } from 'vitest'
import { findEndpointDrift } from '../../src/net/discovery.js'
import { buildAdvertisedEndpoint, upsertPeerUrl } from '../../src/net/index.js'

describe('buildAdvertisedEndpoint', () => {
	it('defaults to scheme://hostname:port', () => {
		expect(buildAdvertisedEndpoint({ hostname: '10.0.0.5', port: 9700 })).toBe(
			'http://10.0.0.5:9700',
		)
	})

	it('uses https when tls is configured', () => {
		expect(buildAdvertisedEndpoint({ tls: true, hostname: 'hub.example.com', port: 9710 })).toBe(
			'https://hub.example.com:9710',
		)
	})

	it('publicUrl overrides host, port, and scheme entirely', () => {
		expect(
			buildAdvertisedEndpoint({
				publicUrl: 'https://club.example.com/mesh',
				tls: false, // proxy terminates TLS; the advertised scheme comes from publicUrl
				hostname: '10.0.0.5',
				port: 9710,
			}),
		).toBe('https://club.example.com/mesh')
	})

	it('strips trailing slashes so endpoint-relative paths do not double up', () => {
		expect(
			buildAdvertisedEndpoint({
				publicUrl: 'https://club.example.com/mesh/',
				hostname: 'x',
				port: 1,
			}),
		).toBe('https://club.example.com/mesh')
	})

	it('ignores a blank publicUrl', () => {
		expect(buildAdvertisedEndpoint({ publicUrl: '  ', hostname: 'h', port: 2 })).toBe('http://h:2')
	})
})

describe('upsertPeerUrl', () => {
	it('appends a new peer with full trust', () => {
		const r = upsertPeerUrl([], 'https://club.example.com/mesh')
		expect(r.peers).toEqual([{ url: 'https://club.example.com/mesh', trust: 'full' }])
		expect(r.replaced).toBeUndefined()
	})

	it('is a no-op when the exact url is already present (modulo trailing slash)', () => {
		const peers = [{ url: 'https://club.example.com/mesh', trust: 'tool' }]
		const r = upsertPeerUrl(peers, 'https://club.example.com/mesh/')
		expect(r.peers).toBe(peers)
		expect(r.replaced).toBeUndefined()
	})

	it('replaces a same-host entry instead of stacking a dead duplicate', () => {
		const r = upsertPeerUrl(
			[
				{ url: 'https://other.example.com:9700', trust: 'read' },
				{ url: 'https://club.example.com:9710', trust: 'tool', allowBrain: false },
			],
			'https://club.example.com/mesh',
		)
		expect(r.replaced).toBe('https://club.example.com:9710')
		expect(r.peers).toHaveLength(2)
		const club = r.peers.find((p) => p.url === 'https://club.example.com/mesh')
		// trust and per-peer settings carry over from the replaced entry
		expect(club).toMatchObject({ trust: 'tool', allowBrain: false })
		expect(r.peers.find((p) => p.url === 'https://other.example.com:9700')).toBeTruthy()
	})

	it('does not touch peers on other hosts', () => {
		const r = upsertPeerUrl([{ url: 'https://a.example.com:9700' }], 'https://b.example.com:9700')
		expect(r.peers).toHaveLength(2)
		expect(r.replaced).toBeUndefined()
	})

	it('tolerates unparseable existing urls', () => {
		const r = upsertPeerUrl([{ url: 'not a url' }], 'https://club.example.com/mesh')
		expect(r.peers).toHaveLength(2)
		expect(r.replaced).toBeUndefined()
	})
})

describe('findEndpointDrift', () => {
	it('flags a same-host configured url that differs from the advertised endpoint', () => {
		expect(
			findEndpointDrift(['https://club.example.com:9710'], 'https://club.example.com/mesh'),
		).toBe('https://club.example.com:9710')
	})

	it('is quiet when the config already matches (modulo trailing slash)', () => {
		expect(
			findEndpointDrift(['https://club.example.com/mesh/'], 'https://club.example.com/mesh'),
		).toBeNull()
	})

	it('ignores advertisements from hosts the config never mentions (other members, NAT guests)', () => {
		expect(
			findEndpointDrift(['https://club.example.com:9710'], 'http://192.168.1.20:9700'),
		).toBeNull()
	})

	it('handles empty config and garbage input', () => {
		expect(findEndpointDrift(undefined, 'https://x.example.com')).toBeNull()
		expect(findEndpointDrift([], 'https://x.example.com')).toBeNull()
		expect(findEndpointDrift(['https://x.example.com'], '')).toBeNull()
		expect(findEndpointDrift(['%%%'], 'https://x.example.com/mesh')).toBeNull()
	})
})
