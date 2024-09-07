import cron from 'node-cron';
import moment from 'moment';
import {
  CHUNK_SIZE,
  EXSAT_RPC_URLS,
  PROCESS_ROWS,
  SYNCHRONIZER_JOBS_BLOCK_FORK_CHECK,
  SYNCHRONIZER_JOBS_BLOCK_PARSE,
  SYNCHRONIZER_JOBS_BLOCK_UPLOAD,
  SYNCHRONIZER_JOBS_BLOCK_VERIFY,
  SYNCHRONIZER_KEYSTORE_FILE
} from '../utils/config';
import { getAccountInfo, getConfigPassword, getInputPassword } from '../utils/keystore';
import { getblock, getblockcount, getblockhash, getChunkMap } from '../utils/bitcoin';
import { configureLogger, logger } from '../utils/logger';
import { envCheck, getErrorMessage, getNextHeight, sleep } from '../utils/common';
import ExsatApi from '../utils/exsat-api';
import TableApi from '../utils/table-api';
import { BlockStatus, ClientType, ContractName, ErrorCode } from '../utils/enumeration';
import {
  blockUploadTotalCounter,
  errorTotalCounter,
  setupPrometheus,
  syncLatestBlockGauge,
  syncLatestTimeGauge,
  warnTotalCounter,
} from '../utils/prom';

let accountName: string;
let exsatApi: ExsatApi;
let tableApi: TableApi;
let uploadingHeight: number = 0;
let [uploadRunning, verifyRunning, parseRunning, forkCheckRunning] = [false, false, false, false];

// Block-related operations
const blockOperations = {
  // Initializes a new bucket for storing block data.
  async initbucket(height: number, hash: string, block_size: number, num_chunks: number) {
    const result: any = await exsatApi.executeAction(ContractName.blksync, 'initbucket', {
      synchronizer: accountName,
      height,
      hash,
      block_size,
      num_chunks,
      chunk_size: CHUNK_SIZE
    });
    if (result) {
      blockUploadTotalCounter.inc({ account: accountName, client: 'synchronizer', status: 'init' });
      logger.info(`Init bucket success, height: ${height}, hash: ${hash}, transaction_id: ${result.transaction_id}`);
    }
  },

  // Deletes an existing block bucket.
  async delbucket(height: number, hash: string) {
    const result: any = await exsatApi.executeAction(ContractName.blksync, 'delbucket', {
      synchronizer: accountName,
      height,
      hash
    });
    if (result) {
      blockUploadTotalCounter.inc({ account: accountName, client: 'synchronizer', status: 'delete' });
      logger.info(`Delete bucket success, height: ${height}, hash: ${hash}, transaction_id: ${result.transaction_id}`);
    }
  },

  // Pushes a chunk of block data to the bucket.
  async pushchunk(height: number, hash: string, chunkId: number, chunkData: string) {
    const result: any = await exsatApi.executeAction(ContractName.blksync, 'pushchunk', {
      synchronizer: accountName,
      height,
      hash,
      chunk_id: chunkId,
      data: chunkData
    });
    if (result) {
      blockUploadTotalCounter.inc({ account: accountName, client: 'synchronizer', status: 'push' });
      logger.info(`Push chunk success, height: ${height}, hash: ${hash}, chunk_id: ${chunkId}, transaction_id: ${result.transaction_id}`);
    }
  },

  // Verifies the integrity and status of a block.
  async verifyBlock(height: number, hash: string) {
    while (true) {
      const result: any = await exsatApi.executeAction(ContractName.blksync, 'verify', {
        synchronizer: accountName,
        height,
        hash
      });
      if (result) {
        logger.info(`Verify block success, height: ${height}, hash: ${hash}, transaction_id: ${result.transaction_id}`);
        const returnValueData = result.processed?.action_traces[0]?.return_value_data;
        if (returnValueData.status === 'verify_pass') {
          logger.info(`Block verify pass, height: ${height}, hash: ${hash}`);
          syncLatestBlockGauge.set({ account: accountName, client: 'synchronizer' }, height);
          blockUploadTotalCounter.inc({ account: accountName, client: 'synchronizer', status: 'verify_pass' });
          syncLatestTimeGauge.set({ account: accountName, client: 'synchronizer' }, Date.now());
          break;
        } else if (returnValueData.status === 'verify_fail') {
          logger.info(`delbucket: Block verify fail, height: ${height}, hash: ${hash}, reason: ${returnValueData.reason}`);
          blockUploadTotalCounter.inc({ account: accountName, client: 'synchronizer', status: 'verify_fail' });
          await this.delbucket(height, hash);
          break;
        }
      }
    }
  }
};

const jobs = {
  async upload() {
    if (uploadRunning) return;
    uploadRunning = true;
    try {
      logger.info('Upload block task is running.');
      const chainstate = await tableApi.getChainstate();
      if (!chainstate) {
        logger.error('Get chainstate error.');
        errorTotalCounter.inc({ account: accountName, client: 'synchronizer' });
        return;
      }
      const blockcountInfo = await getblockcount();
      if (chainstate.head_height >= blockcountInfo.result) {
        logger.info('No new block found.');
        return;
      }
      const synchronizerInfo = await tableApi.getSynchronizerInfo(accountName);
      if (!synchronizerInfo) {
        logger.error(`Get synchronizer[${accountName}] info error.`);
        errorTotalCounter.inc({ account: accountName, client: 'synchronizer' });
        return;
      }
      const nextHeight = chainstate.head_height + 1;
      let uploadHeight = nextHeight;
      const blockbuckets = await tableApi.getAllBlockbucket(accountName);
      const uploadedHeights = new Set(blockbuckets.map(item => item.height));
      if (blockbuckets && blockbuckets.length > 0) {
        const holdSlots: number = synchronizerInfo.num_slots;
        const usedSlots: number = blockbuckets.length;
        const minBucket = blockbuckets[0];
        const maxBucket = blockbuckets[blockbuckets.length - 1];
        if (usedSlots >= holdSlots) {
          if (minBucket.height > nextHeight) {
            logger.info(`delbucket: The prev block need reupload, height: ${minBucket.height}, hash: ${minBucket.hash}`);
            await blockOperations.delbucket(maxBucket.height, maxBucket.hash);
          } else {
            logger.info(`The number of blockbuckets[${usedSlots}] has reached the upper limit[${holdSlots}], Please purchase more slots or wait for the slots to be released`);
            await sleep(10000);
          }
          return;
        }
        uploadHeight = uploadedHeights.has(nextHeight) ? getNextHeight(uploadedHeights) : nextHeight;
      }
      const blockhashInfo = await getblockhash(uploadHeight);
      const hash = blockhashInfo.result;
      try {
        const blockInfo = await getblock(hash);
        if (blockInfo.result === null && blockInfo.error?.code === -5) {
          logger.info(`Block not found, height: ${uploadHeight}, hash: ${hash}`);
          return;
        } else if (blockInfo.error) {
          logger.error(`Get block raw error, height: ${uploadHeight}, hash: ${hash}`, blockInfo.error);
          errorTotalCounter.inc({ account: accountName, client: 'synchronizer' });
          return;
        }
        const blockRaw = blockInfo.result;
        const chunkMap: Map<number, string> = await getChunkMap(blockRaw);
        uploadingHeight = uploadHeight;
        await blockOperations.initbucket(uploadHeight, hash, blockRaw.length / 2, chunkMap.size);
        for (const [chunkId, chunkData] of chunkMap) {
          await blockOperations.pushchunk(uploadHeight, hash, chunkId, chunkData);
        }
      } catch (e: any) {
        const errorMessage = getErrorMessage(e);
        if (errorMessage.includes('duplicate transaction')) {
          //Ignore duplicate transaction
          await sleep();
        } else if (errorMessage.startsWith(ErrorCode.Code2005)) {
          logger.info(`The block has reached consensus, height: ${uploadHeight}, hash: ${hash}`);
        } else if (errorMessage.startsWith(ErrorCode.Code2008) || errorMessage.startsWith(ErrorCode.Code2013)) {
          //Ignore
        } else {
          logger.error(`Upload block task error, height: ${uploadHeight}, hash: ${hash}`, e);
          errorTotalCounter.inc({ account: accountName, client: 'synchronizer' });
          await sleep();
        }
      }
    } catch (error) {
      logger.error('Error in upload task:', error);
      errorTotalCounter.inc({ account: accountName, client: 'synchronizer' });
    } finally {
      uploadingHeight = 0;
      uploadRunning = false;
    }
  },

  async verify() {
    if (verifyRunning) return;
    verifyRunning = true;
    let logHeight: number = 0;
    let logHash: string = '';
    try {
      logger.info('Verify block task is running.');
      const chainstate = await tableApi.getChainstate();
      if (!chainstate) {
        logger.error('Get chainstate error.');
        errorTotalCounter.inc({ account: accountName, client: 'synchronizer' });
        return;
      }
      const blockbuckets = await tableApi.getAllBlockbucket(accountName);
      if (!blockbuckets || blockbuckets.length === 0) {
        logger.info('No blockbucket found.');
        return;
      }
      let verifyBucket;
      for (const blockbucket of blockbuckets) {
        if (chainstate.head_height >= blockbucket.height) {
          //Delete blocks that have been endorsed
          await blockOperations.delbucket(blockbucket.height, blockbucket.hash);
        } else {
          if (!verifyBucket) {
            verifyBucket = blockbucket;
          }
        }
      }
      if (!verifyBucket) {
        logger.info('No blockbucket need to verify.');
        return;
      }
      const {
        bucket_id,
        height,
        hash,
        status,
        size,
        uploaded_size,
        num_chunks,
        uploaded_num_chunks,
        chunk_size
      } = verifyBucket;
      logHeight = height;
      logHash = hash;
      logger.info(`Verify blockbucket, status: ${status}, height: ${height}, hash: ${hash}`);
      switch (status) {
        case BlockStatus.UPLOADING:
          if (uploadingHeight === height) {
            break;
          }
          const blockInfo = await getblock(hash);
          if (blockInfo.result === null && blockInfo.error?.code === -5) {
            logger.info(`delbucket: Block not found, height: ${height}, hash: ${hash}`);
            await blockOperations.delbucket(height, hash);
            break;
          } else if (blockInfo.error) {
            logger.error(`Get block raw error, height: ${height}, hash: ${hash}`, blockInfo.error);
            errorTotalCounter.inc({ account: accountName, client: 'synchronizer' });
            break;
          }
          const blockRaw = blockInfo.result;
          //Block sharding
          const chunkMap: Map<number, string> = await getChunkMap(blockRaw);
          if ((size === uploaded_size && num_chunks !== uploaded_num_chunks)
            || (size !== uploaded_size && num_chunks === uploaded_num_chunks)
            || chunk_size !== CHUNK_SIZE) {
            //Delete the block first, then initialize and re-upload
            logger.info(`delbucket: Blockbucket size and uploaded_size are inconsistent`);
            await blockOperations.delbucket(height, hash);
            await blockOperations.initbucket(height, hash, blockRaw.length / 2, chunkMap.size);
          }
          const newBlockbucket = await tableApi.getBlockbucketById(accountName, bucket_id);
          if (!newBlockbucket) {
            break;
          }
          for (const item of chunkMap) {
            const chunkId: number = item[0];
            const chunkData: string = item[1];
            if (newBlockbucket.chunk_ids.includes(chunkId)) {
              continue;
            }
            await blockOperations.pushchunk(height, hash, chunkId, chunkData);
          }
          break;
        case BlockStatus.UPLOAD_COMPLETE:
        case BlockStatus.VERIFY_MERKLE:
        case BlockStatus.VERIFY_PARENT_HASH:
          await blockOperations.verifyBlock(height, hash);
          break;
        case BlockStatus.WAITING_MINER_VERIFICATION:
          const consensusBlk = await tableApi.getConsensusByBucketId(accountName, bucket_id);
          //todo
          logger.error(`-----consensusBlk=${JSON.stringify(consensusBlk)}----`);
          logger.error(`----verifyBucket.id=${bucket_id}-----chainstate.irreversible_height=${chainstate.irreversible_height}------verifyBucket.height=${verifyBucket.height}-----------------`);
          if (consensusBlk || chainstate.irreversible_height >= verifyBucket.height) {
            //The block has been completed by consensus and can be deleted
            logger.info(`delbucket: The block has been completed by consensus, height: ${height}, hash: ${hash}`);
            await blockOperations.delbucket(height, hash);
          } else {
            await blockOperations.verifyBlock(height, hash);
          }
          break;
        case BlockStatus.VERIFY_FAIL:
          logger.info(`delbucket: Block verify fail, height: ${height}, hash: ${hash}`);
          await blockOperations.delbucket(height, hash);
          break;
        case BlockStatus.VERIFY_PASS:
          logger.info(`Block verify pass, Wait for the validator to endorse the block, height: ${height}, hash: ${hash}`);
          break;
        default:
          break;
      }
    } catch (e: any) {
      const errorMessage = getErrorMessage(e);
      if (errorMessage.startsWith(ErrorCode.Code2017)) {
        logger.info('blockbucket has been deleted.');
      } else if (errorMessage.includes('duplicate transaction')) {
        //Ignore duplicate transaction
      } else if (errorMessage.startsWith(ErrorCode.Code2005)) {
        logger.info(`The block has reached consensus, height: ${logHeight}, hash: ${logHash}`);
      } else if (errorMessage.startsWith(ErrorCode.Code2018)) {
        //Ignore
      } else if (errorMessage.startsWith(ErrorCode.Code2013)) {
        //Ignore
      } else if (errorMessage.startsWith(ErrorCode.Code2020)) {
        //Ignore
      } else if (errorMessage.startsWith(ErrorCode.Code2022)) {
        //Ignore
      } else {
        errorTotalCounter.inc({ account: accountName, client: 'synchronizer' });
        logger.error(`Verify block task error, height: ${logHeight}, hash: ${logHash}`, e);
        await sleep();
      }
    } finally {
      verifyRunning = false;
    }
  },

  async parse() {
    if (parseRunning) return;
    parseRunning = true;
    try {
      logger.info('Parse block task is running.');
      const chainstate = await tableApi.getChainstate();
      if (!chainstate) {
        logger.error('Get chainstate error.');
        errorTotalCounter.inc({ account: accountName, client: 'synchronizer' });
        return;
      }
      for (const item of chainstate.parsing_progress_of) {
        const parseInfo = item.second;
        if (parseInfo.parser === accountName || moment.utc().isAfter(moment.utc(parseInfo.parse_expiration_time))) {
          let processRows: number = PROCESS_ROWS;
          while (true) {
            try {
              const parseResult: any = await exsatApi.executeAction(ContractName.utxomng, 'processblock', {
                synchronizer: accountName,
                process_rows: processRows,
              });
              if (parseResult) {
                logger.info(`Parse block success, transaction_id: ${parseResult.transaction_id}`);
                const returnValueDate = parseResult.processed?.action_traces[0]?.return_value_data;
                if (returnValueDate.status !== 'parsing') {
                  break;
                }
              }
            } catch (e: any) {
              const errorMessage = getErrorMessage(e);
              if (errorMessage.includes('reached node configured max-transaction-time')) {
                processRows = Math.ceil(processRows * 0.618);
              } else if (errorMessage.includes('the transaction was unable to complete by deadline, but it is possible it could have succeeded if it were allowed to run to completion')) {
                processRows = Math.ceil(processRows * 0.5);
                logger.warn(`Parse block failed, height=${chainstate.head_height}, message=${e.message}`);
                warnTotalCounter.inc({ account: accountName, client: 'synchronizer' });
              } else if (errorMessage.includes('duplicate transaction')) {
                //Ignore duplicate transaction
                await sleep();
              } else {
                logger.error(`Parse block failed, height=${chainstate.head_height}, stack=${e.stack}`);
                errorTotalCounter.inc({ account: accountName, client: 'synchronizer' });
                await sleep();
                break;
              }
            }
          }
        }
      }
    } catch (e) {
      logger.error('Parse block task error', e);
      errorTotalCounter.inc({ account: accountName, client: 'synchronizer' });
      await sleep();
    } finally {
      parseRunning = false;
    }
  },

  async forkCheck() {
    if (forkCheckRunning) return;
    forkCheckRunning = true;
    let height: number = 0;
    let hash: string = '';
    try {
      logger.info('Block fork check task is running.');
      const chainstate = await tableApi.getChainstate();
      if (!chainstate) {
        logger.error('Get chainstate error.');
        errorTotalCounter.inc({ account: accountName, client: 'synchronizer' });
        return;
      }
      const blockcountInfo = await getblockcount();
      if (chainstate.irreversible_height <= blockcountInfo.result - 6) {
        return;
      }
      height = chainstate.irreversible_height + 1;
      const blockhashInfo = await getblockhash(height);
      hash = blockhashInfo.result;
      const consensusblk = await tableApi.getConsensusByBlockId(BigInt(height), hash);
      if (consensusblk) {
        return;
      }
      //Delete all occupied card slots when a fork occurs
      const blockbuckets = await tableApi.getAllBlockbucket(accountName);
      if (blockbuckets && blockbuckets.length > 0) {
        for (const blockbucket of blockbuckets) {
          logger.info(`delete: Bitcoin fork happen, height: ${blockbucket.height}, hash: ${blockbucket.hash}`);
          await blockOperations.delbucket(blockbucket.height, blockbucket.hash);
        }
      }
      const blockInfo = await getblock(hash);
      if (blockInfo.result === null && blockInfo.error?.code === -5) {
        logger.info(`Block not found, height: ${height}, hash: ${hash}`);
        return;
      } else if (blockInfo.error) {
        logger.error(`Get block raw error, height: ${height}, hash: ${hash}`, blockInfo.error);
        errorTotalCounter.inc({ account: accountName, client: 'synchronizer' });
        return;
      }
      const blockRaw = blockInfo.result;
      const chunkMap: Map<number, string> = await getChunkMap(blockRaw);
      await blockOperations.initbucket(height, hash, blockRaw.length / 2, chunkMap.size);
      for (const item of chunkMap) {
        await blockOperations.pushchunk(height, hash, item[0], item[1]);
      }
    } catch (e: any) {
      const errorMessage = getErrorMessage(e);
      if (errorMessage.includes('duplicate transaction')) {
        //Ignore duplicate transaction
        await sleep();
      } else if (errorMessage.startsWith(ErrorCode.Code2005)) {
        logger.info(`The block has reached consensus, height: ${height}, hash: ${hash}`);
      } else if (errorMessage.startsWith(ErrorCode.Code2013)) {
        //Ignore
      } else {
        logger.error(`Fork check block task error, height: ${height}, hash: ${hash}`, e);
        errorTotalCounter.inc({ account: accountName, client: 'synchronizer' });
        await sleep();
      }
    } finally {
      forkCheckRunning = false;
    }
  },
};

function setupCronJobs() {
  const cronJobs = [
    { schedule: SYNCHRONIZER_JOBS_BLOCK_UPLOAD, job: jobs.upload },
    { schedule: SYNCHRONIZER_JOBS_BLOCK_VERIFY, job: jobs.verify },
    { schedule: SYNCHRONIZER_JOBS_BLOCK_PARSE, job: jobs.parse },
    { schedule: SYNCHRONIZER_JOBS_BLOCK_FORK_CHECK, job: jobs.forkCheck }
  ];

  cronJobs.forEach(({ schedule, job }) => {
    cron.schedule(schedule, () => {
      job().catch(error => {
        logger.error(`Unhandled error in ${job.name} job:`, error);
        errorTotalCounter.inc({ account: accountName, client: 'synchronizer' });
      });
    });
  });
}

async function main() {
  configureLogger('synchronizer');
  await envCheck(SYNCHRONIZER_KEYSTORE_FILE);
  let password = getConfigPassword(ClientType.Synchronizer);
  let accountInfo;
  if (password) {
    password = password.trim();
    accountInfo = await getAccountInfo(SYNCHRONIZER_KEYSTORE_FILE, password);
  } else {
    while (!accountInfo) {
      try {
        password = await getInputPassword();
        if (password.trim() === 'q') {
          process.exit(0);
        }
        accountInfo = await getAccountInfo(SYNCHRONIZER_KEYSTORE_FILE, password);
      } catch (e) {
        logger.warn(e);
        warnTotalCounter.inc({ account: accountName, client: 'synchronizer' });
      }
    }
  }
  accountName = accountInfo.accountName;
  exsatApi = new ExsatApi(accountInfo, EXSAT_RPC_URLS);
  await exsatApi.initialize();
  tableApi = new TableApi(exsatApi);
  await exsatApi.checkClient(ClientType.Synchronizer);
}

(async () => {
  try {
    await main();
    setupCronJobs();
    setupPrometheus();
  } catch (e) {
    logger.error(e);
  }
})();
