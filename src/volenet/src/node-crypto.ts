/**
 * The parts of Node's crypto that `@types/node` does not describe yet.
 *
 * Node 24 on OpenSSL 3.5 ships ML-KEM (`encapsulate`/`decapsulate`), and accepts an
 * `authTagLength` option for ChaCha20-Poly1305 while the types model that option as CCM-only,
 * which makes them insist `setAAD` takes a second argument. Both are real gaps between a shipped
 * runtime and its published types, not unsound code — so they are narrowed here, once, with the
 * reason attached, rather than left as a repo-wide `tsc` failure or papered over with `any` at
 * each call site.
 *
 * Delete this file when @types/node catches up; the call sites will keep compiling.
 */
import type * as crypto from 'node:crypto'

/** ML-KEM-768 key encapsulation, as Node implements it. */
export interface MlKemApi {
	encapsulate(key: crypto.KeyObject): { sharedKey: Uint8Array; ciphertext: Uint8Array }
	decapsulate(key: crypto.KeyObject, ciphertext: Buffer): Uint8Array
}

/** An AEAD cipher whose `setAAD` takes only the AAD, which is the case for ChaCha20-Poly1305. */
export interface AeadCipher {
	setAAD(aad: Buffer): unknown
	update(data: Buffer): Buffer
	final(): Buffer
	getAuthTag(): Buffer
}

export interface AeadDecipher {
	setAAD(aad: Buffer): unknown
	setAuthTag(tag: Buffer): unknown
	update(data: Buffer): Buffer
	final(): Buffer
}

/** The ML-KEM half of the crypto module. Call sites still guard for its absence at runtime. */
export const mlkem = (mod: typeof crypto): MlKemApi => mod as unknown as MlKemApi

export const aead = (cipher: unknown): AeadCipher => cipher as AeadCipher
export const aeadOpen = (decipher: unknown): AeadDecipher => decipher as AeadDecipher
