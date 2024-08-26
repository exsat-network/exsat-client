// @ts-ignore
import crypto from 'crypto';
import { Name, Checksum160 } from '@wharfkit/antelope';

type Checksum256 = Buffer

/**
 * Compute SHA-256 hash
 * @param data Input data
 * @returns SHA-256 hash value
 */
function sha256(data: Buffer): Checksum256 {
  return crypto.createHash('sha256').update(data).digest();
}

/**
 * Generates a SHA-256 hash of the provided string data.
 * @param data - The input string to be hashed.
 * @returns The SHA-256 hash of the input data in hexadecimal format.
 */
function hash(data: string) {
  return sha256(Buffer.from(data)).toString('hex');
}

/**
 * Compute block ID
 * @param height Block height
 * @param hash
 * @returns Computed block ID
 */
export function computeBlockId(height: bigint, hash: string): string {
  const result = Buffer.alloc(40);
  result.writeBigUInt64LE(height);
  result.write(hash, 8, 'hex');
  return sha256(result).toString('hex');
}

/**
 * Compute Proxy ID
 * @param proxy Evm Proxy Address
 */
export function computeId(proxy: Checksum160): string {
  const result = Buffer.alloc(32);
  result.write(proxy.toString(), 12, 'hex');
  return result.toString('hex');
}

/**
 * Compute Staker ID
 * @param proxy Evm Proxy Address
 * @param staker Staker Address
 * @param validator Validator Address
 * @returns Computed Staker ID
 */
export function computeStakerId(proxy: string, staker: string, validator: Name): string {
  const result = Buffer.alloc(48);
  result.write(proxy, 0, 'hex');
  result.write(staker, 20, 'hex');
  result.writeBigUInt64LE(validator.value.value, 40);
  return sha256(result).toString('hex');
}
