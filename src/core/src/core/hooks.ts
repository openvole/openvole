/**
 * Hook phase definitions.
 *
 * The actual hook execution logic lives in PawRegistry (perceive/observe hooks)
 * and the agent loop (think/act orchestration). This module defines the hook
 * lifecycle constants and types used across the system.
 */

/** The four phases of the agent loop */
export type LoopPhase = 'perceive' | 'think' | 'act' | 'observe'

/** Phase ordering for logging and tracing */
export const PHASE_ORDER: readonly LoopPhase[] = ['perceive', 'think', 'act', 'observe'] as const
