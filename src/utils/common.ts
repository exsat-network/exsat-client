import axios from 'axios';
import fs from 'node:fs';
import { BTC_RPC_URL, CHUNK_SIZE, EXSAT_RPC_URLS } from './config';
import { logger } from './logger';
import { getblockcount } from './bitcoin';
import path from "node:path";
import dotenv from "dotenv";

/**
 * Pauses execution for a specified number of milliseconds.
 * @param ms - The number of milliseconds to sleep.
 */
export async function sleep(ms: number = 2000): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extracts the numeric amount from a string representing a quantity.
 * @param quantity - The string containing the amount and currency (e.g., "0.50000000 BTC").
 * @returns The numeric amount as a number.
 */
export function getAmountFromQuantity(quantity: string): number {
  const amount: string = quantity?.split(' ')[0] || '0';
  return Number(amount);
}

/**
 * Retrieves the RPC URLs from an exsat API.
 * @returns A promise that resolves to the data containing RPC URLs.
 */
export async function getRpcUrls() {
  const response = await axios.get(
    `${process.env.ACCOUNT_INITIALIZER_API_BASE_URL}/api/config/exsat_config`,
    {
      headers: {
        'x-api-key': process.env.ACCOUNT_INITIALIZER_API_SECRET,
      },
    },
  );
  return response.data;
}

/**
 * Checks the environment for required configurations and exits the process if any are missing.
 * @param keystoreFile - The path to the keystore file.
 */
export async function envCheck(keystoreFile: string) {
  if (!fs.existsSync(keystoreFile)) {
    logger.error('No keystore file found, please config .env file first');
    process.exit(1);
  }
  if (!BTC_RPC_URL) {
    logger.error('BTC_RPC_URL is not set');
    process.exit(1);
  }
  if (EXSAT_RPC_URLS.length === 0) {
    const result = await getRpcUrls();
    if (result && result.status === 'success' && result.info?.exsat_rpc) {
      // @ts-ignore
      EXSAT_RPC_URLS = result.info.exsat_rpc;
    }
  }
  if (EXSAT_RPC_URLS.length === 0) {
    logger.error('No valid EXSAT RPC URL found');
    process.exit(1);
  }
  const blockcountInfo = await getblockcount();
  if (blockcountInfo.error) {
    logger.error('Failed to get the block count from the Bitcoin network');
    process.exit(1);
  }
  if (CHUNK_SIZE < 102400) {
    logger.error('The CHUNK_SIZE must be greater than 102400 in .env file');
    process.exit(1);
  }
}

/**
 * Try calling the function repeatedly
 * @param fn
 * @param retries
 */
export const retry = async (
  fn: () => Promise<any>,
  retries = 3,
  delay = 1000,
  ft = '',
): Promise<any> => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      await sleep(delay);
      logger.warn(`${ft} Retrying... (${i + 1}/${retries})`);
    }
  }
};

// Function to validate URL
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch (_) {
    return false;
  }
}

// Functions to validate JSON strings
export function isValidJson(jsonString: string): boolean {
  try {
    JSON.parse(jsonString);
    return true;
  } catch (error) {
    return false;
  }
}

export function showInfo(info) {
  console.log('-----------------------------------------------');
  for (const key in info) {
    if (info.hasOwnProperty(key)) {
      console.log(`${key}: ${info[key]}`);
    }
  }
  console.log('-----------------------------------------------\n');
}

/**
 * Get the error message from an error object.
 * If the error message starts with 'assertion failure with message: ',
 * return the message after the prefix.
 * @param e
 */
export function getErrorMessage(e: any): string {
  let errorMessage = e?.message || '';
  const prefix = 'assertion failure with message: ';
  if (errorMessage.startsWith(prefix)) {
    return errorMessage.substring(prefix.length);
  }
  return errorMessage;
}

/**
 * Get the min and max bucket from a list of blockbuckets.
 * @param blockbuckets
 */
export function getMinMaxBucket(blockbuckets) {
  let minBucket = blockbuckets[0], maxBucket = blockbuckets[0];
  for (const blockbucket of blockbuckets) {
    if (minBucket.height > blockbucket.height) {
      minBucket = blockbucket;
    }
    if (maxBucket.height < blockbucket.height) {
      maxBucket = blockbucket;
    }
  }
  return { minBucket, maxBucket };
}

/**
 * Get the next upload height.
 * @param currentUploadedHeights
 * @param headHeight
 */
export function getNextUploadHeight(currentUploadedHeights: number[], headHeight: number): number {
  if (currentUploadedHeights.length === 0) {
    return headHeight + 1;
  }
  const sortedHeights = [...currentUploadedHeights].sort((a, b) => a - b);
  if (sortedHeights[0] > headHeight + 1) {
    return headHeight + 1;
  }
  if (sortedHeights[sortedHeights.length - 1] < headHeight) {
    return headHeight + 1;
  }
  let nextUploadHeight = headHeight + 1;
  while (sortedHeights.includes(nextUploadHeight)) {
    nextUploadHeight++;
  }
  if (nextUploadHeight < sortedHeights[sortedHeights.length - 1]) {
    return nextUploadHeight;
  }
  return sortedHeights[sortedHeights.length - 1] + 1;
}

/**
 * Check if running in Docker.
 */
export function isExsatDocker(): boolean {
  try {
    // Check for /.dockerenv file
    if (fs.existsSync('/exsat.lock')) {
      return true;
    }
  } catch (err) {
    console.error('Error checking if running in Docker:', err);
  }

  return false;
}

/**
 * Reload the .env file.
 */
export function reloadEnv() {
  let envFilePath;
  if (isExsatDocker()) {
    envFilePath = path.resolve(__dirname, '../../.exsat', '.env');
  } else {
    envFilePath = path.resolve(__dirname, '../../', '.env');
  }
  if (!fs.existsSync(envFilePath)) {
    throw new Error('No .env file found');
  }
  dotenv.config({ override: true, path: envFilePath });
}