import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(
	defineConfig({
	title: 'OpenVole',
	description: 'The self-hosted OS for AI agents — your hardware, any model, peer-to-peer networked.',
	base: '/openvole/',
	themeConfig: {
		logo: '/vole.png',
		nav: [
			{ text: 'Guide', link: '/getting-started' },
			{ text: 'Dashboard', link: '/dashboard' },
			{ text: 'Paws', link: '/paws' },
			{ text: 'API', link: '/configuration' },
			{ text: 'Changelog', link: '/changelog' },
			{ text: 'GitHub', link: 'https://github.com/openvole/openvole' },
		],
		sidebar: [
			{
				text: 'Introduction',
				items: [
					{ text: 'What is OpenVole?', link: '/' },
					{ text: 'Getting Started', link: '/getting-started' },
					{ text: 'Dashboard', link: '/dashboard' },
					{ text: 'Configuration', link: '/configuration' },
				],
			},
			{
				text: 'Core Concepts',
				items: [
					{ text: 'Architecture', link: '/architecture' },
					{ text: 'Context Management', link: '/context' },
					{ text: 'Skills', link: '/skills' },
					{ text: 'Security', link: '/security' },
				],
			},
			{
				text: 'Paws',
				items: [
					{ text: 'Overview', link: '/paws' },
					{ text: 'Brain Paws', link: '/paws-brain' },
					{ text: 'Channel Paws', link: '/paws-channel' },
					{ text: 'Tool Paws', link: '/paws-tool' },
					{ text: 'Infrastructure Paws', link: '/paws-infrastructure' },
				],
			},
			{
				text: 'VoleNet',
				items: [
					{ text: 'Distributed Networking', link: '/volenet' },
					{ text: 'Relay (design draft)', link: '/volenet-relay' },
				],
			},
			{
				text: 'CLI',
				items: [{ text: 'Commands', link: '/cli' }],
			},
			{
				text: 'Community',
				items: [
					{ text: 'Contributing', link: '/contributing' },
					{ text: 'Changelog', link: '/changelog' },
				],
			},
		],
		socialLinks: [
			{ icon: 'github', link: 'https://github.com/openvole/openvole' },
			{ icon: 'npm', link: 'https://www.npmjs.com/package/openvole' },
		],
		footer: {
			message: '🐹 built by <a href="https://shyble.github.io">Kürşat Kutlu Aydemir</a>',
		},
		search: {
			provider: 'local',
		},
	},
}),
)
