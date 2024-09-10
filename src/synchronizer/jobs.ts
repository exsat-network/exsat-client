import { getblock, getblockcount, getblockhash, getChunkMap } from '../utils/bitcoin';
import { logger } from '../utils/logger';
import { getErrorMessage, getNextUploadHeight, sleep } from '../utils/common';
import { BlockStatus, Client, ContractName, ErrorCode } from '../utils/enumeration';
import { errorTotalCounter, warnTotalCounter, } from '../utils/prom';
import { BlockOperations } from './blockOperations';
import { SynchronizerState } from './index';
import { CHUNK_SIZE, PROCESS_ROWS } from '../utils/config';
import moment from 'moment';

export class SynchronizerJobs {
  constructor(public state: SynchronizerState, private blockOperations: BlockOperations) {
  }

  uploadBlock = async (caller: string, uploadHeight: number) => {
    let hash: string = '';
    try {
      const blockhashInfo = await getblockhash(uploadHeight);
      hash = blockhashInfo.result;
      const blockInfo = await getblock(hash);
      if (blockInfo.result === null && blockInfo.error?.code === -5) {
        logger.info(`Block not found, height: ${uploadHeight}, hash: ${hash}`);
        return;
      } else if (blockInfo.error) {
        logger.error(`Get block raw error, height: ${uploadHeight}, hash: ${hash}`, blockInfo.error);
        errorTotalCounter.inc({ account: this.state.accountName, client: Client.Synchronizer });
        return;
      }
      const blockRaw = blockInfo.result;
      const chunkMap: Map<number, string> = await getChunkMap(blockRaw);
      await this.blockOperations.initbucket(caller, uploadHeight, hash, blockRaw.length / 2, chunkMap.size);
      for (const [chunkId, chunkData] of chunkMap) {
        await this.blockOperations.pushchunk(caller, uploadHeight, hash, chunkId, chunkData);
      }
    } catch (e) {
      const errorMessage = getErrorMessage(e);
      if (errorMessage.includes('duplicate transaction')) {
        //Ignore duplicate transaction
        await sleep();
      } else if (errorMessage.startsWith(ErrorCode.Code2005)) {
        logger.info(`The block has reached consensus, height: ${uploadHeight}, hash: ${hash}`);
      } else if (errorMessage.startsWith(ErrorCode.Code2006) || errorMessage.startsWith(ErrorCode.Code2012) || errorMessage.startsWith(ErrorCode.Code2019)) {
        logger.warn(errorMessage);
        warnTotalCounter.inc({ account: this.state.accountName, client: Client.Synchronizer });
      } else if (errorMessage.startsWith(ErrorCode.Code2008) || errorMessage.startsWith(ErrorCode.Code2013)) {
        //Ignore
      } else {
        logger.error(`Upload block task error, height: ${uploadHeight}, hash: ${hash}`, e);
        errorTotalCounter.inc({ account: this.state.accountName, client: Client.Synchronizer });
        await sleep();
      }
    }
  };

  upload = async () => {
    console.log('uploadLock-----------', this.state.uploadLock.queue.length); //todo
    await this.state.uploadLock.acquire();
    try {
      const caller = 'upload';
      logger.info('Upload block task is running.');
      const chainstate = await this.state.tableApi!.getChainstate();
      if (!chainstate) {
        logger.error('Get chainstate error.');
        errorTotalCounter.inc({ account: this.state.accountName, client: Client.Synchronizer });
        return;
      }
      const blockcountInfo = await getblockcount();
      if (chainstate.head_height >= blockcountInfo.result) {
        logger.info('No new block found.');
        return;
      }
      const synchronizerInfo = await this.state.tableApi!.getSynchronizerInfo(this.state.accountName);
      if (!synchronizerInfo) {
        logger.error(`Get synchronizer[${this.state.accountName}] info error.`);
        errorTotalCounter.inc({ account: this.state.accountName, client: Client.Synchronizer });
        return;
      }
      const blockbuckets = await this.state.tableApi!.getAllBlockbucket(this.state.accountName);
      const uploadedHeights: number[] = blockbuckets.map(item => item.height);
      logger.info(`[${caller}] all blockbuckets height: ${uploadedHeights.join(', ')}`);

      if (!blockbuckets || blockbuckets.length === 0) {
        const nextUploadHeight = getNextUploadHeight(uploadedHeights, chainstate.head_height);
        await this.uploadBlock(caller, nextUploadHeight);
      } else {
        const uploadingBlockbucket = blockbuckets.find(item => item.status === BlockStatus.UPLOADING);
        if (uploadingBlockbucket) {
          const {
            bucket_id,
            height,
            hash,
            size,
            uploaded_size,
            num_chunks,
            uploaded_num_chunks,
            chunk_size
          } = uploadingBlockbucket;
          const blockInfo = await getblock(hash);
          if (blockInfo.result === null && blockInfo.error?.code === -5) {
            logger.info(`delbucket: Block not found, height: ${height}, hash: ${hash}`);
            await this.blockOperations.delbucket(caller, height, hash);
            return;
          } else if (blockInfo.error) {
            logger.error(`Get block raw error, height: ${height}, hash: ${hash}`, blockInfo.error);
            errorTotalCounter.inc({ account: this.state.accountName, client: Client.Synchronizer });
            return;
          }
          const blockRaw = blockInfo.result;
          //Block sharding
          const chunkMap: Map<number, string> = await getChunkMap(blockRaw);
          if ((size === uploaded_size && num_chunks !== uploaded_num_chunks)
            || (size !== uploaded_size && num_chunks === uploaded_num_chunks)
            || chunk_size !== CHUNK_SIZE) {
            //Delete the block first, then initialize and re-upload
            logger.info(`delbucket: Blockbucket size and uploaded_size are inconsistent`);
            await this.blockOperations.delbucket(caller, height, hash);
            await this.blockOperations.initbucket(caller, height, hash, blockRaw.length / 2, chunkMap.size);
          }
          const newBlockbucket = await this.state.tableApi!.getBlockbucketById(this.state.accountName, bucket_id);
          if (!newBlockbucket) {
            return;
          }
          for (const item of chunkMap) {
            const chunkId: number = item[0];
            const chunkData: string = item[1];
            if (newBlockbucket.chunk_ids.includes(chunkId)) {
              continue;
            }
            await this.blockOperations.pushchunk(caller, height, hash, chunkId, chunkData);
          }
          return;
        }
        const holdSlots: number = synchronizerInfo.num_slots;
        const usedSlots: number = blockbuckets.length;
        if (usedSlots < holdSlots) {
          const nextUploadHeight = getNextUploadHeight(uploadedHeights, chainstate.head_height);
          await this.uploadBlock(caller, nextUploadHeight);
        } else {
          const minBucket = blockbuckets[0];
          const maxBucket = blockbuckets[blockbuckets.length - 1];
          if (minBucket.height > chainstate.head_height + 1) {
            logger.info(`delbucket: The prev block need reupload, height: ${minBucket.height}, hash: ${minBucket.hash}`);
            await this.blockOperations.delbucket(caller, maxBucket.height, maxBucket.hash);
          } else {
            logger.info(`The number of blockbuckets[${usedSlots}] has reached the upper limit[${holdSlots}], Please purchase more slots or wait for the slots to be released`);
            await sleep(5000);
          }
        }
      }
    } finally {
      this.state.uploadLock.release();
    }
  };

  verify = async () => {
    await this.state.verifyLock.acquire();
    const caller = 'verify';
    let logHeight: number = 0;
    let logHash: string = '';
    try {
      logger.info('Verify block task is running.');
      const chainstate = await this.state.tableApi!.getChainstate();
      if (!chainstate) {
        logger.error('Get chainstate error.');
        errorTotalCounter.inc({ account: this.state.accountName, client: Client.Synchronizer });
        return;
      }
      const blockbuckets = await this.state.tableApi!.getAllBlockbucket(this.state.accountName);
      if (!blockbuckets || blockbuckets.length === 0) {
        logger.info('No blockbucket found.');
        return;
      }
      const result = blockbuckets.map(obj => obj.height).join(', ');
      logger.info(`[${caller}] all blockbuckets height: ${result}`);

      let verifyBucket;
      for (const blockbucket of blockbuckets) {
        if (chainstate.head_height >= blockbucket.height) {
          //Delete blocks that have been endorsed
          logger.info(`delbucket: The block has been endorsed, height: ${blockbucket.height}, hash: ${blockbucket.hash}`);
          await this.blockOperations.delbucket(caller, blockbucket.height, blockbucket.hash);
        } else {
          if (!verifyBucket) {
            verifyBucket = blockbucket;
            break;
          }
        }
      }
      if (!verifyBucket) {
        logger.info('No blockbucket need to verify.');
        return;
      }

      const { bucket_id, height, hash, status, } = verifyBucket;
      logHeight = height;
      logHash = hash;
      logger.info(`Verify blockbucket, status: ${status}, height: ${height}, hash: ${hash}`);
      switch (status) {
        case BlockStatus.UPLOAD_COMPLETE:
        case BlockStatus.VERIFY_MERKLE:
        case BlockStatus.VERIFY_PARENT_HASH:
          await this.blockOperations.verifyBlock(caller, height, hash);
          break;
        case BlockStatus.WAITING_MINER_VERIFICATION:
          const consensusBlk = await this.state.tableApi!.getConsensusByBucketId(this.state.accountName, bucket_id);
          if (consensusBlk || chainstate.irreversible_height >= verifyBucket.height) {
            //The block has been completed by consensus and can be deleted
            logger.info(`delbucket: The block has been completed by consensus, height: ${height}, hash: ${hash}`);
            await this.blockOperations.delbucket(caller, height, hash);
          } else {
            await this.blockOperations.verifyBlock(caller, height, hash);
          }
          break;
        case BlockStatus.VERIFY_FAIL:
          logger.info(`delbucket: Block verify fail, height: ${height}, hash: ${hash}`);
          await this.blockOperations.delbucket(caller, height, hash);
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
        errorTotalCounter.inc({ account: this.state.accountName, client: Client.Synchronizer });
        logger.error(`Verify block task error, height: ${logHeight}, hash: ${logHash}`, e);
        await sleep();
      }
    } finally {
      this.state.verifyLock.release();
    }
  };

  parse = async () => {
    await this.state.parseLock.acquire();
    try {
      logger.info('Parse block task is running.');
      const chainstate = await this.state.tableApi!.getChainstate();
      if (!chainstate) {
        logger.error('Get chainstate error.');
        errorTotalCounter.inc({ account: this.state.accountName, client: Client.Synchronizer });
        return;
      }
      for (const item of chainstate.parsing_progress_of) {
        const parseInfo = item.second;
        if (parseInfo.parser === this.state.accountName || moment.utc().isAfter(moment.utc(parseInfo.parse_expiration_time))) {
          let processRows: number = PROCESS_ROWS;
          while (true) {
            try {
              const parseResult: any = await this.state.exsatApi!.executeAction(ContractName.utxomng, 'processblock', {
                synchronizer: this.state.accountName,
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
                warnTotalCounter.inc({ account: this.state.accountName, client: Client.Synchronizer });
              } else if (errorMessage.includes('duplicate transaction')) {
                //Ignore duplicate transaction
                await sleep();
              } else {
                logger.error(`Parse block failed, chainstate=${JSON.stringify(chainstate)}, stack=${e.stack}`);
                errorTotalCounter.inc({ account: this.state.accountName, client: Client.Synchronizer });
                await sleep();
                break;
              }
            }
          }
        }
      }
    } catch (e: any) {
      logger.error('Parse block task error', e);
      errorTotalCounter.inc({ account: this.state.accountName, client: Client.Synchronizer });
      await sleep();
    } finally {
      this.state.parseLock.release();
    }
  };

  forkCheck = async () => {
    await this.state.forkCheckLock.acquire();
    let height: number = 0;
    let hash: string = '';
    try {
      const caller = 'forkCheck';
      logger.info('Fork check task is running.');
      const chainstate = await this.state.tableApi!.getChainstate();
      if (!chainstate) {
        logger.error('Get chainstate error.');
        errorTotalCounter.inc({ account: this.state.accountName, client: Client.Synchronizer });
        return;
      }
      const blockcountInfo = await getblockcount();
      if (chainstate.irreversible_height <= blockcountInfo.result - 6) {
        return;
      }
      height = chainstate.irreversible_height + 1;
      const blockhashInfo = await getblockhash(height);
      hash = blockhashInfo.result;
      const consensusblk = await this.state.tableApi!.getConsensusByBlockId(BigInt(height), hash);
      if (consensusblk) {
        return;
      }
      //Delete all occupied card slots when a fork occurs
      const blockbuckets = await this.state.tableApi!.getAllBlockbucket(this.state.accountName);
      if (blockbuckets && blockbuckets.length > 0) {
        const result = blockbuckets.map(obj => obj.height).join(', ');
        logger.info(`forkCheck: all blockbuckets height: ${result}`);
        for (const blockbucket of blockbuckets) {
          logger.info(`delete: Bitcoin fork happen, height: ${blockbucket.height}, hash: ${blockbucket.hash}`);
          await this.blockOperations.delbucket(caller, blockbucket.height, blockbucket.hash);
        }
      }
      const blockInfo = await getblock(hash);
      if (blockInfo.result === null && blockInfo.error?.code === -5) {
        logger.info(`Block not found, height: ${height}, hash: ${hash}`);
        return;
      } else if (blockInfo.error) {
        logger.error(`Get block raw error, height: ${height}, hash: ${hash}`, blockInfo.error);
        errorTotalCounter.inc({ account: this.state.accountName, client: Client.Synchronizer });
        return;
      }
      const blockRaw = blockInfo.result;
      const chunkMap: Map<number, string> = await getChunkMap(blockRaw);
      await this.blockOperations.initbucket(caller, height, hash, blockRaw.length / 2, chunkMap.size);
      for (const item of chunkMap) {
        await this.blockOperations.pushchunk(caller, height, hash, item[0], item[1]);
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
        errorTotalCounter.inc({ account: this.state.accountName, client: Client.Synchronizer });
        await sleep();
      }
    } finally {
      this.state.forkCheckLock.release();
    }
  };
}
