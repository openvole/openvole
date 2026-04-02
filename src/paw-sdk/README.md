# @openvole/paw-sdk

SDK for building [OpenVole](https://github.com/openvole/openvole) Paws — tool providers for the agent loop.

[![npm](https://img.shields.io/npm/v/@openvole/paw-sdk)](https://www.npmjs.com/package/@openvole/paw-sdk)

## Install

```bash
npm install @openvole/paw-sdk
```

## Quick Start

```typescript
import { definePaw, z } from '@openvole/paw-sdk'

export default definePaw({
  name: 'my-paw',
  version: '0.1.0',
  description: 'My custom paw',

  tools: [
    {
      name: 'my_tool',
      description: 'Does something useful',
      parameters: z.object({ input: z.string() }),
      execute: async ({ input }) => ({ result: input.toUpperCase() }),
    },
  ],

  async onLoad() {
    console.log('Paw loaded')
  },
})
```

## What's a Paw?

A Paw connects OpenVole to the outside world. It runs in an isolated subprocess and registers tools that the Brain can call.

**Types of Paws:**
- **Brain** — implements the Think phase (e.g., paw-brain)
- **Channel** — receives messages from users (e.g., paw-telegram, paw-slack)
- **Tool** — provides capabilities (e.g., paw-browser, paw-shell)
- **Infrastructure** — internal services (e.g., paw-memory, paw-session)

## Hooks

```typescript
hooks: {
  onBootstrap: async (context) => context,  // once per task
  onPerceive: async (context) => context,   // before Think
  onObserve: async (result) => {},          // after each tool call
  onCompact: async (context) => context,    // when context too large
}
```

## Transport

Paws communicate with the core via JSON-RPC 2.0 over IPC. The SDK handles all wiring — just export `definePaw()`.

## License

[MIT](https://github.com/openvole/openvole/blob/main/LICENSE)
