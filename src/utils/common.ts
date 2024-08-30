import axios from 'axios';
import fs from 'node:fs';
import { BTC_RPC_URL, EXSAT_RPC_URLS } from './config';
import { logger } from './logger';
import { getblockcount } from './bitcoin';

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
}
