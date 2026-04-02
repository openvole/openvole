import { defineConfig } from 'vitepress'

export default defineConfig({
	title: 'OpenVole',
	description: 'Microkernel AI Agent Framework',
	base: '/openvole/',
	themeConfig: {
		logo: '/vole.png',
		nav: [
			{ text: 'Guide', link: '/getting-started' },
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
				items: [{ text: 'Distributed Networking', link: '/volenet' }],
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
			message: 'Released under the MIT License.',
			copyright: 'Copyright © 2026 OpenVole',
		},
		search: {
			provider: 'local',
		},
	},
})
