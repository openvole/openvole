import { vi } from 'vitest'

// Suppress all console output during tests to keep output clean
vi.spyOn(console, 'info').mockImplementation(() => {})
vi.spyOn(console, 'warn').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})
vi.spyOn(console, 'debug').mockImplementation(() => {})
vi.spyOn(console, 'log').mockImplementation(() => {})
