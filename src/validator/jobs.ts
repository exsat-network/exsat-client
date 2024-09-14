import { logger } from '../utils/logger';
import { getErrorMessage, sleep } from '../utils/common';
import { Client, ContractName, ErrorCode } from '../utils/enumeration';
import {
  blockValidateTotalCounter,
  errorTotalCounter,
  validateLatestBlockGauge,
  validateLatestTimeGauge
} from '../utils/prom';
import { ValidatorState } from './index';
import { getblockcount, getblockhash } from '../utils/bitcoin';

export class ValidatorJobs {
  constructor(public state: ValidatorState) {
  }

  // Check if the account is qualified to endorse
  isEndorserQualified(endorsers: {
    account: string
    staking: number
  }[], accountName: string): boolean {
    return endorsers.some(endorser => endorser.account === accountName);
  }

  // Check if an endorsement is needed and submit if necessary
  async checkAndSubmit(accountName: string, height: number, hash: string) {
    const endorsement = await this.state.tableApi!.getEndorsementByBlockId(height, hash);
    if (endorsement) {
      let isQualified = this.isEndorserQualified(endorsement.requested_validators, accountName);
      if (isQualified && !this.isEndorserQualified(endorsement.provider_validators, accountName)) {
        await this.submit(accountName, height, hash);
      } else {
        this.state.lastEndorseHeight = height;
      }
    } else {
      await this.submit(accountName, height, hash);
    }
  }

  // Submit an endorsement to the blockchain
  async submit(validator: string, height: number, hash: string) {
    const result: any = await this.state.exsatApi!.executeAction(ContractName.blkendt, 'endorse', {
      validator,
      height,
      hash
    });
    if (result && result.transaction_id) {
      this.state.lastEndorseHeight = height;
      blockValidateTotalCounter.inc({ account: this.state.accountName, client: Client.Validator });
      validateLatestBlockGauge.set({ account: this.state.accountName, client: Client.Validator }, height);
      validateLatestTimeGauge.set({ account: this.state.accountName, client: Client.Validator }, Date.now());
      logger.info(`Submit endorsement success, accountName: ${validator}, height: ${height}, hash: ${hash}, transaction_id: ${result?.transaction_id}`);
    }
  }

  endorse = async () => {
    if (this.state.endorseRunning) {
      return;
    }
    this.state.endorseRunning = true;
    try {
      if (!this.state.startupStatus) {
        this.state.startupStatus = await this.state.tableApi!.getStartupStatus();
        if (!this.state.startupStatus) {
          logger.info('The exSat Network has not officially launched yet. Please wait for it to start');
          await sleep(30000);
          return;
        }
      }
      logger.info('Endorse task is running');
      const blockcountInfo = await getblockcount();
      const blockhashInfo = await getblockhash(blockcountInfo.result);
      await this.checkAndSubmit(this.state.accountName, blockcountInfo.result, blockhashInfo.result);
    } catch (e) {
      const errorMessage = getErrorMessage(e);
      logger.info(`Endorse task info: ${errorMessage}`);
      if (errorMessage.startsWith(ErrorCode.Code1001) || errorMessage.startsWith(ErrorCode.Code1003)) {
        await sleep(10000);
        // ignore
      } else {
        logger.error('Endorse task error', e);
        errorTotalCounter.inc({ account: this.state.accountName, client: Client.Validator });
      }
    } finally {
      logger.info('Endorse task is finished');
      this.state.endorseRunning = false;
    }
  };

  endorseCheck = async () => {
    if (this.state.endorseCheckRunning) {
      return;
    }
    this.state.endorseCheckRunning = true;
    try {
      logger.info('Endorse check task is running');
      const chainstate = await this.state.tableApi!.getChainstate();
      const blockcount = await getblockcount();
      let startEndorseHeight = chainstate!.irreversible_height + 1;
      if (this.state.lastEndorseHeight > startEndorseHeight && this.state.lastEndorseHeight < blockcount.result - 6) {
        startEndorseHeight = this.state.lastEndorseHeight;
      }
      for (let i = startEndorseHeight; i <= blockcount.result; i++) {
        let hash: string;
        try {
          const blockhash = await getblockhash(i);
          hash = blockhash.result;
          logger.info(`Check endorsement for block ${i}/${blockcount.result}`);
          await this.checkAndSubmit(this.state.accountName, i, blockhash.result);
        } catch (e: any) {
          const errorMessage = getErrorMessage(e);
          logger.info(`Endorse check task result, height: ${i}, hash: ${hash}, ${errorMessage}`);
          if (errorMessage.startsWith(ErrorCode.Code1002)) {
          } else if (errorMessage.startsWith(ErrorCode.Code1001) || errorMessage.startsWith(ErrorCode.Code1003)) {
            await sleep(10000);
            return;
          } else {
            logger.error(`Submit endorsement failed, height: ${i}, hash: ${hash}`, e);
            errorTotalCounter.inc({ account: this.state.accountName, client: Client.Validator });
          }
        }
      }
    } catch (e) {
      logger.error('Endorse check task error', e);
      errorTotalCounter.inc({ account: this.state.accountName, client: Client.Validator });
      await sleep();
    } finally {
      logger.info("Endorse check task is finished.");
      this.state.endorseCheckRunning = false;
    }
  };
}
