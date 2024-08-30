import cron from 'node-cron';
import {
  EXSAT_RPC_URLS, PROMETHEUS, PROMETHEUS_ADDRESS,
  VALIDATOR_JOBS_ENDORSE,
  VALIDATOR_JOBS_ENDORSE_CHECK,
  VALIDATOR_KEYSTORE_FILE
} from '../utils/config';
import { getAccountInfo, getConfigPassword, getInputPassword } from '../utils/keystore';
import { getblockcount, getblockhash } from '../utils/bitcoin';
import { configureLogger, logger } from '../utils/logger';
import { envCheck, sleep } from '../utils/common';
import ExsatApi from '../utils/exsat-api';
import TableApi from '../utils/table-api';
import { ClientType, ContractName } from '../utils/enumeration';
import {
  setUpPrometheus,
  errorTotalCounter,
  warnTotalCounter,
  blockValidateTotalCounter,
  validateLatestBlockGauge,
  validateLatestTimeGauge
} from '../utils/prom';

// Global variables to track job status and store API instances
let [endorseRunning, endorseCheckRunning, startupStatus] = [false, false, false];
let accountName: string;
let exsatApi: ExsatApi;
let tableApi: TableApi;
let lastEndorseHeight: number = 0;

const endorseOperations = {
  // Check if the account is qualified to endorse
  isEndorserQualified(endorsers: {
    account: string
    staking: number
  }[], accountName: string): boolean {
    return endorsers.some(endorser => endorser.account === accountName);
  },

  // Check if an endorsement is needed and submit if necessary
  async checkAndSubmit(accountName: string, height: number, hash: string) {
    const endorsement = await tableApi.getEndorsementByBlockId(height, hash);
    if (endorsement) {
      let isQualified = this.isEndorserQualified(endorsement.requested_validators, accountName);
      if (isQualified && !this.isEndorserQualified(endorsement.provider_validators, accountName)) {
        await this.submit(accountName, height, hash);
      } else {
        lastEndorseHeight = height;
      }
    } else {
      await this.submit(accountName, height, hash);
    }
  },

  // Submit an endorsement to the blockchain
  async submit(validator: string, height: number, hash: string) {
    const result: any = await exsatApi.executeAction(ContractName.blkendt, 'endorse', { validator, height, hash });
    if (result && result.transaction_id) {
      lastEndorseHeight = height;
      logger.info(`Submit endorsement success, accountName: ${validator}, height: ${height}, hash: ${hash}, transaction_id: ${result?.transaction_id}`);
    }
  },
};

const jobs = {
  async endorse() {
    if (!startupStatus) {
      startupStatus = await tableApi.getStartupStatus();
      if (!startupStatus) {
        logger.info('The exSat Network has not officially launched yet. Please wait for it to start.');
        return;
      }
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
      await endorseOperations.checkAndSubmit(accountName, blockcountInfo.result, blockhashInfo.result);
    } catch (e: any) {
      const errorMessage = e.message || '';
      if (errorMessage.includes('blkendt.xsat::endorse: the current endorsement status is disabled')
        || errorMessage.includes('blkendt.xsat::endorse: the endorsement height cannot exceed height')) {
        logger.warn('Endorse task result', e);
      } else {
        errorTotalCounter.inc({ account: accountName, client: 'validator' });
        logger.error('Endorse task error', e);
      }
    } finally {
      endorseRunning = false;
    }
  },

  async endorseCheck() {
    if (!startupStatus) {
      startupStatus = await tableApi.getStartupStatus();
      if (!startupStatus) {
        logger.info('The exSat Network has not officially launched yet. Please wait for it to start.');
        return;
      }
    }
    if (endorseCheckRunning) {
      return;
    }
    endorseCheckRunning = true;
    try {
      logger.info('Endorse check task is running.');
      const chainstate = await tableApi.getChainstate();
      if (!chainstate) {
        logger.error('Get chainstate error.');
        return;
      }

      const blockcount = await getblockcount();
      let startEndorseHeight = chainstate.irreversible_height + 1;
      if (lastEndorseHeight > startEndorseHeight && lastEndorseHeight < blockcount.result - 6) {
        startEndorseHeight = lastEndorseHeight;
      }
      for (let i = startEndorseHeight; i <= blockcount.result; i++) {
        let hash: string;
        try {
          const blockhash = await getblockhash(i);
          hash = blockhash.result;
          logger.info(`Check endorsement for block ${i}/${blockcount.result}`);
          await endorseOperations.checkAndSubmit(accountName, i, blockhash.result);
        } catch (e: any) {
          const errorMessage = e.message || '';
          if (errorMessage.includes('blkendt.xsat::endorse: the block has been parsed and does not need to be endorsed')) {
            logger.info(`The block has been parsed and does not need to be endorsed, height: ${i}, hash: ${hash}`);
          } else if (errorMessage.includes('blkendt.xsat::endorse: the current endorsement status is disabled')
            || errorMessage.includes('blkendt.xsat::endorse: the endorsement height cannot exceed height')) {
            logger.warn(`Wait for endorsement status to be enabled, height: ${i}, hash: ${hash}`);
            return;
          } else {
            logger.error(`Submit endorsement failed, height: ${i}, hash: ${hash}`, e);
          }
        }
      }
    } catch (e) {
      logger.error('Endorse check task error', e);
      errorTotalCounter.inc({ account: accountName, client: 'validator' });
      await sleep();
    } finally {
      endorseCheckRunning = false;
    }
  }
};

// Set up cron jobs for endorsing and checking endorsements
function setupCronJobs() {
  const cronJobs = [
    { schedule: VALIDATOR_JOBS_ENDORSE, job: jobs.endorse },
    { schedule: VALIDATOR_JOBS_ENDORSE_CHECK, job: jobs.endorseCheck },
  ];

  cronJobs.forEach(({ schedule, job }) => {
    cron.schedule(schedule, () => {
      job().catch(error => {
        console.error(`Unhandled error in ${job.name} job:`, error);
      });
    });
  });
}

// Initialize the main application
async function main() {
  configureLogger('validator');
  await envCheck(VALIDATOR_KEYSTORE_FILE);
  let password = getConfigPassword(ClientType.Validator);
  let accountInfo;
  if (password) {
    password = password.trim();
    accountInfo = await getAccountInfo(VALIDATOR_KEYSTORE_FILE, password);
  } else {
    while (!accountInfo) {
      try {
        password = getInputPassword();
        if (password.trim() === 'q') {
          process.exit(0);
        }
        accountInfo = await getAccountInfo(VALIDATOR_KEYSTORE_FILE, password);
      } catch (e) {
        logger.warn(e);
      }
    }
  }
  accountName = accountInfo.accountName;
  exsatApi = new ExsatApi(accountInfo, EXSAT_RPC_URLS);
  await exsatApi.initialize();
  tableApi = new TableApi(exsatApi);
  await exsatApi.checkClient(ClientType.Validator);
}

// Entry point of the application
(async () => {
  try {
    await main();
    await setupCronJobs();
    setUpPrometheus();
  } catch (e) {
    logger.error(e);
  }
})();
