import cron from 'node-cron';
import { getAccountInfo, getConfigPassword, getInputPassword } from '../utils/keystore';
import { configureLogger, logger } from '../utils/logger';
import { envCheck, loadNetworkConfigurations } from '../utils/common';
import ExsatApi from '../utils/exsat-api';
import TableApi from '../utils/table-api';
import { Client, ClientType } from '../utils/enumeration';
import { errorTotalCounter, setupPrometheus, startTimeGauge, warnTotalCounter } from '../utils/prom';
import { ValidatorJobs } from './jobs';
import {
  EXSAT_RPC_URLS,
  HEARTBEAT_JOBS,
  VALIDATOR_JOBS_ENDORSE,
  VALIDATOR_JOBS_ENDORSE_CHECK,
  VALIDATOR_KEYSTORE_FILE,
} from '../utils/config';
import ExsatNode from '../utils/exsat-node';

export class ValidatorState {
  accountName: string = '';
  exsatApi: ExsatApi | null = null;
  tableApi: TableApi | null = null;
  lastEndorseHeight: number = 0;
  startupStatus: boolean = false;
  endorseRunning: boolean = false;
  endorseCheckRunning: boolean = false;
}

async function initializeAccount(): Promise<{
  accountInfo: any;
  password: string;
}> {
  let password = getConfigPassword(ClientType.Validator);
  let accountInfo;
  if (password) {
    password = password.trim();
    accountInfo = await getAccountInfo(VALIDATOR_KEYSTORE_FILE, password);
  } else {
    while (!accountInfo) {
      try {
        password = await getInputPassword();
        if (password.trim() === 'q') {
          process.exit(0);
        }
        accountInfo = await getAccountInfo(VALIDATOR_KEYSTORE_FILE, password);
      } catch (e) {
        logger.warn(e);
        warnTotalCounter.inc({
          account: accountInfo?.accountName,
          client: Client.Validator,
        });
      }
    }
  }

  return { accountInfo, password };
}

async function setupApis(accountInfo: any): Promise<{ exsatApi: ExsatApi; tableApi: TableApi }> {
  const exsatNode = new ExsatNode(EXSAT_RPC_URLS);
  const exsatApi = new ExsatApi(accountInfo, exsatNode);
  await exsatApi.initialize();
  const tableApi = await TableApi.getInstance();
  await exsatApi.checkClient(ClientType.Validator);
  return { exsatApi, tableApi };
}

function setupCronJobs(jobs: ValidatorJobs) {
  const cronJobs = [
    { schedule: VALIDATOR_JOBS_ENDORSE, job: jobs.endorse },
    { schedule: VALIDATOR_JOBS_ENDORSE_CHECK, job: jobs.endorseCheck },
    { schedule: HEARTBEAT_JOBS, job: jobs.heartbeat },
  ];

  cronJobs.forEach(({ schedule, job }) => {
    cron.schedule(schedule, async () => {
      try {
        await job();
      } catch (error) {
        logger.error(`Unhandled error in ${job.name} job:`, error);
        errorTotalCounter.inc({
          account: jobs.state.accountName,
          client: Client.Validator,
        });
      }
    });
  });
}
async function main() {
  await loadNetworkConfigurations();
  configureLogger(Client.Validator);
  await envCheck(VALIDATOR_KEYSTORE_FILE);

  const { accountInfo } = await initializeAccount();
  const { exsatApi, tableApi } = await setupApis(accountInfo);

  const state = new ValidatorState();
  state.accountName = accountInfo.accountName;
  state.exsatApi = exsatApi;
  state.tableApi = tableApi;

  const jobs = new ValidatorJobs(state);

  setupCronJobs(jobs);
  setupPrometheus();
  startTimeGauge.set({ account: accountInfo.accountName, client: Client.Validator }, Date.now());
}

(async () => {
  try {
    await main();
  } catch (e) {
    logger.error(e);
  }
})();
