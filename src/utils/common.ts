import fs from 'node:fs';
import {
  BTC_RPC_URL,
  CHUNK_SIZE,
  EXSAT_RPC_URLS,
  IS_DOCKER,
  NETWORK,
  NETWORK_CONFIG,
  setExsatRpcUrls,
  setNetworkConfig,
} from './config';
import { logger } from './logger';
import { getblockcount } from './bitcoin';
import path from 'node:path';
import dotenv from 'dotenv';
import { Font } from './font';
import { ClientType } from './enumeration';
import { getKeystorePath } from '../commander/common';
import { getAccountInfo, getConfigPassword, getInputPassword } from './keystore';
import { warnTotalCounter } from './prom';
import { http } from './http';

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
  try {
    const response = await http.get(
      `https://raw.githubusercontent.com/exsat-network/configurations/refs/heads/main/src/${NETWORK}-network.json`
    );
    return response.data.native.nodes;
  } catch (error) {
    logger.error('Failed to get ExSat RPC URLs', error);
    throw error;
  }
}

export async function loadNetworkConfigurations() {
  try {
    const response = await http.get(
      `https://raw.githubusercontent.com/exsat-network/configurations/refs/heads/main/src/${NETWORK}-network.json`
    );

    if (!EXSAT_RPC_URLS || EXSAT_RPC_URLS.length === 0 || !isValidUrl(EXSAT_RPC_URLS[0])) {
      setExsatRpcUrls(response.data.native.nodes);
    }
    if (!NETWORK_CONFIG) {
      setNetworkConfig(response.data.app);
    }
  } catch (error) {
    logger.error('Failed to get ExSat RPC URLs', error);
    throw error;
  }
}

/**
 * Checks the environment for required configurations and exits the process if any are missing.
 * @param clientType - The client type.
 */
export async function envCheck(clientType: ClientType) {
  const keystoreFile = getKeystorePath(clientType);
  if (!fs.existsSync(keystoreFile)) {
    logger.error(
      `No ${clientType === ClientType.Synchronizer ? 'synchronizer' : 'validator'} keystore file found, please config .env file first`
    );
    process.exit(1);
  }
  if (!BTC_RPC_URL) {
    logger.error('BTC_RPC_URL is not set');
    process.exit(1);
  }
  if (!EXSAT_RPC_URLS || EXSAT_RPC_URLS.length === 0 || !isValidUrl(EXSAT_RPC_URLS[0])) {
    const result = await getRpcUrls();
    if (result) {
      setExsatRpcUrls(result);
    }
  }
  if (!EXSAT_RPC_URLS || EXSAT_RPC_URLS.length === 0 || !isValidUrl(EXSAT_RPC_URLS[0])) {
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
 * @param fn - The function to be called.
 * @param retries - The number of retries.
 * @param delay - The delay between retries.
 * @param ft - The function name.
 */
export const retry = async (fn: () => Promise<any>, retries = 3, delay = 1000, ft = ''): Promise<any> => {
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

/**
 * Print info to the console.
 * @param info
 */
export function showInfo(info) {
  console.log(`${Font.fgCyan}${Font.bright}-----------------------------------------------${Font.reset}`);
  for (const key in info) {
    if (info.hasOwnProperty(key)) {
      console.log(`${Font.fgCyan}${Font.bright}${key}: ${Font.reset}${Font.bright}${info[key]}${Font.reset}`);
    }
  }
  console.log(`${Font.fgCyan}${Font.bright}-----------------------------------------------${Font.reset}`);
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
  let minBucket = blockbuckets[0],
    maxBucket = blockbuckets[0];
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
 * @param forkHeight
 */
export function getNextUploadHeight(currentUploadedHeights: number[], headHeight: number, forkHeight: number): number {
  if (forkHeight > 0) {
    return forkHeight;
  }
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
 * Reload the .env file.
 */
export function reloadEnv() {
  let envFilePath;
  if (IS_DOCKER) {
    envFilePath = path.join(process.cwd(), '.exsat', '.env');
  } else {
    envFilePath = path.join(process.cwd(), '.env');
  }
  if (!fs.existsSync(envFilePath)) {
    throw new Error(`No .env file found, IS_DOCKER=${IS_DOCKER}`);
  }
  dotenv.config({ override: true, path: envFilePath });
}

export function updateEnvFile(values) {
  let envFilePath;
  if (IS_DOCKER) {
    envFilePath = path.join(process.cwd(), '.exsat', '.env');
  } else {
    envFilePath = path.join(process.cwd(), '.env');
  }
  if (!fs.existsSync(envFilePath)) {
    fs.writeFileSync(envFilePath, '');
  }
  const envConfig = dotenv.parse(fs.readFileSync(envFilePath, 'utf-8'));
  Object.keys(values).forEach((key) => {
    envConfig[key] = values[key];
  });
  // Read original .env file contents
  const originalEnvContent = fs.readFileSync(envFilePath, 'utf-8');

  // Parse original .env file contents
  const parsedEnv = dotenv.parse(originalEnvContent);

  // Build updated .env file contents, preserving comments and structure
  const updatedLines = originalEnvContent.split('\n').map((line) => {
    const [key] = line.split('=');
    if (key && envConfig.hasOwnProperty(key)) {
      return `${key}=${envConfig[key.trim()]}`;
    }
    return line;
  });

  // Check if any new key-value pairs need to be added to the end of the file
  Object.keys(envConfig).forEach((key) => {
    if (!parsedEnv.hasOwnProperty(key)) {
      updatedLines.push(`${key}=${envConfig[key]}`);
    }
  });
  // Concatenate updated content into string
  const updatedEnvContent = updatedLines.join('\n');
  // Write back the updated .env file contents
  fs.writeFileSync(envFilePath, updatedEnvContent);

  return true;
}

/**
 * Check if transaction id is 64 digit hexadecimal
 * @param txid
 */
export function isValidTxid(txid: string): boolean {
  // Check if the length is 64
  if (txid.length !== 64) {
    return false;
  }
  // Check if it is hexadecimal
  const hexRegex = /^[0-9a-fA-F]+$/;
  return hexRegex.test(txid);
}

export function isValidEvmAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Remove trailing zeros from a value
 * @param value
 */
export function removeTrailingZeros(value) {
  if (!value) return 0;
  if (typeof value == 'number') return value;
  const [amount, unit] = value.split(' ');
  return `${parseFloat(amount)} ${unit}`;
}

/**
 * Normalize account name
 * @param name - account name
 */
export function normalizeAccountName(name: string) {
  return name.endsWith('.sat') ? name : `${name}.sat`;
}

/**
 * Initialize account info
 * @param clientType
 */
export async function initializeAccount(clientType: ClientType): Promise<{
  accountInfo: any;
  password: string;
}> {
  const keystoreFile = getKeystorePath(clientType);
  let password = getConfigPassword(clientType);
  let accountInfo;
  if (password) {
    password = password.trim();
    accountInfo = await getAccountInfo(keystoreFile, password);
  } else {
    while (!accountInfo) {
      try {
        password = await getInputPassword();
        if (password.trim() === 'q') {
          process.exit(0);
        }
        accountInfo = await getAccountInfo(keystoreFile, password);
      } catch (e) {
        logger.warn(e);
        warnTotalCounter.inc({
          account: accountInfo?.accountName,
          client: clientType == ClientType.Synchronizer ? 'synchronizer' : 'validator',
        });
      }
    }
  }

  return { accountInfo, password };
}
