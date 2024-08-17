import cron from 'node-cron';
import { getblockcount, getblockhash } from '../utils/bitcoin';
import { logger } from '../utils/logger';
import fs from 'node:fs';
import {
  EXSAT_RPC_URLS,
  RETRY_INTERVAL_MS,
  VALIDATOR_JOBS_ENDORSE,
  VALIDATOR_JOBS_ENDORSE_CHECK,
  VALIDATOR_KEYSTORE_FILE
} from '../utils/config';
import { getAccountInfo } from '../utils/keystore';
import ExsatApi from '../utils/exsat-api';
import TableApi from '../utils/table-api';
import { sleep } from '../utils/common';

let [endorseRunning, endorseCheckRunning, startupStatus] = [false, false, false];
let accountName: string;
let exsatApi: ExsatApi;
let tableApi: TableApi;

async function checkStartupStatus() {
  if (startupStatus) {
    return true;
  }
  const rows = await exsatApi.getTableRows('blkendt.xsat', 'blkendt.xsat', 'config');
  // @ts-ignore
  return rows && rows.length > 0 && rows[0].disabled_endorse === 0;
}

function isEndorserQualified(endorsers: {
  account: string
  staking: number
}[], accountName: string): boolean {
  return endorsers.some(endorser => endorser.account === accountName);
}

async function checkAndSubmitEndorsement(accountName: string, height: number, hash: string) {
  const endorsement = await tableApi.getEndorsementByBlockId(height, hash);

  if (endorsement) {
    let isQualified = isEndorserQualified(endorsement.requested_validators, accountName);
    if (isQualified && !isEndorserQualified(endorsement.provider_validators, accountName)) {
      await submitEndorsement(accountName, height, hash);
    }
  } else {
    await submitEndorsement(accountName, height, hash);
  }
}

async function submitEndorsement(validator: string, height: number, hash: string) {
  try {
    const result = await exsatApi.executeAction('blkendt.xsat', 'endorse', { validator, height, hash });
    logger.info(`Submit endorsement success, accountName: ${validator}, height: ${height}, hash: ${hash}, transaction_id: ${result.response!.transaction_id}`);
  } catch (error) {
    logger.error(`Submit endorsement failed, accountName: ${validator}, height: ${height}, hash: ${hash}`, error);
  }
}

async function setupCronJobs() {
  cron.schedule(VALIDATOR_JOBS_ENDORSE, async () => {
    if (!await checkStartupStatus()) {
      logger.info('The exSat Network has not officially launched yet. Please wait for it to start.');
      return;
    }
    try {
      if (endorseRunning) {
        logger.info('Endorse task is already running. Skipping this round.');
        return;
      }
      endorseRunning = true;
      logger.info('Endorse task is running.');
      const blockcountInfo = await getblockcount();
      const blockhashInfo = await getblockhash(blockcountInfo.result);
      await checkAndSubmitEndorsement(accountName, blockcountInfo.result, blockhashInfo.result);
    } catch (e) {
      logger.error('Endorse task error', e);
      await sleep(RETRY_INTERVAL_MS);
    } finally {
      endorseRunning = false;
    }
  });

  cron.schedule(VALIDATOR_JOBS_ENDORSE_CHECK, async () => {
    if (!await checkStartupStatus()) {
      return;
    }
    if (endorseCheckRunning) {
      return;
    }
    endorseCheckRunning = true;
    try {
      logger.info('Endorse check task is running.');
      const latestRewardHeight = await tableApi.getLatestRewardHeight();
      if (latestRewardHeight === 0) {
        logger.info('No reward height found.');
        return;
      }
      const blockcount = await getblockcount();
      for (let i = latestRewardHeight + 1; i <= blockcount.result; i++) {
        const blockhash = await getblockhash(i);
        logger.info(`Checking endorsement for block ${i}/${blockcount.result}`);
        await checkAndSubmitEndorsement(accountName, i, blockhash.result);
      }
    } catch (e) {
      logger.error('Endorse check task error', e);
      await sleep(RETRY_INTERVAL_MS);
    } finally {
      endorseCheckRunning = false;
    }
  });
}

async function main() {
  if (!fs.existsSync(VALIDATOR_KEYSTORE_FILE)) {
    logger.error('No keystore file found, please config .env file first');
    process.exit(1);
  }
  const accountInfo = await getAccountInfo();
  accountName = accountInfo.accountName;
  exsatApi = new ExsatApi(accountInfo, EXSAT_RPC_URLS);
  tableApi = new TableApi(exsatApi);
  await exsatApi.checkClient(2);
}

(async () => {
  try {
    await main();
    await setupCronJobs();
  } catch (e) {
    logger.error(e);
  }
})();
