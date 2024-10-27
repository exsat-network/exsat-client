import ExsatApi from './exsat-api';
import { ContractName, IndexPosition, KeyType } from './enumeration';
import { computeBlockId } from './key';
import { logger } from './logger';
import { Checksum256, Name, UInt64 } from '@wharfkit/session';

class TableApi {
  private exsatApi: ExsatApi;

  /**
   * Initializes TableApi with an ExsatApi instance.
   * @param exsatApi - The ExsatApi instance to use for API calls.
   */
  constructor(exsatApi: ExsatApi) {
    this.exsatApi = exsatApi;
  }

  /**
   * Checks if the exSat network has started.
   * @returns A boolean indicating the startup status.
   */
  public async getStartupStatus() {
    const rows: any = await this.exsatApi.getTableRows(ContractName.blkendt, ContractName.blkendt, 'config');
    if (rows) {
      if (rows.length === 0) {
        return true;
      } else {
        return rows[0].limit_endorse_height >= 0;
      }
    }
    return false;
  }

  /**
   * Gets endorsement information by block height and hash.
   * @param height - The block height.
   * @param hash - The block hash.
   * @returns The endorsement data or null if not found.
   */
  public async getEndorsementByBlockId(height: number, hash: string): Promise<any> {
    const rows = await this.exsatApi.getTableRows(ContractName.blkendt, height, 'endorsements', {
      index_position: IndexPosition.Secondary,
      upper_bound: Checksum256.from(hash),
      lower_bound: Checksum256.from(hash),
      key_type: KeyType.Sha256,
      limit: 1,
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  /**
   * Retrieves the current chain state.
   * @returns The chain state data or null if not found.
   */
  public async getChainstate(): Promise<any> {
    const rows = await this.exsatApi.getTableRows(ContractName.utxomng, ContractName.utxomng, 'chainstate');
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  /**
   * Retrieves the synchronizer information by account name.
   * @param synchronizer
   */
  public async getSynchronizerInfo(synchronizer: string): Promise<any> {
    const rows = await this.exsatApi.getTableRows(ContractName.poolreg, ContractName.poolreg, 'synchronizer', {
      limit: 1,
      lower_bound: Name.from(synchronizer),
      upper_bound: Name.from(synchronizer),
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  /**
   * Retrieves the validator information by account name.
   * @param validator
   */
  public async getValidatorInfo(validator: string): Promise<any> {
    const rows = await this.exsatApi.getTableRows(ContractName.endrmng, ContractName.endrmng, 'validators', {
      limit: 1,
      lower_bound: Name.from(validator),
      upper_bound: Name.from(validator),
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  /**
   * get account balance
   */
  public async getAccountBalance(account: string): Promise<any> {
    const rows: any[] = await this.exsatApi.getTableRows(ContractName.rescmng, ContractName.rescmng, 'accounts', {
      limit: 1,
      lower_bound: Name.from(account),
      upper_bound: Name.from(account),
    });
    if (rows && rows.length > 0) {
      return rows[0].balance;
    }
    return 0;
  }

  /**
   * Retrieves a block bucket by its ID.
   * @param synchronizer - The synchronizer account name.
   * @param bucketId - The bucket ID.
   * @returns The block bucket data or null if not found.
   */
  public async getBlockbucketById(synchronizer: string, bucketId: number): Promise<any> {
    const rows = await this.exsatApi.getTableRows(ContractName.blksync, synchronizer, 'blockbuckets', {
      index_position: IndexPosition.Primary,
      upper_bound: UInt64.from(bucketId),
      lower_bound: UInt64.from(bucketId),
      key_type: KeyType.I64,
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  /**
   * Retrieves all block buckets for a given synchronizer.
   * @param caller
   * @param synchronizer - The synchronizer account name.
   * @returns An array of block buckets.
   */
  public async getAllBlockbucket(caller: string, synchronizer: string): Promise<any> {
    const rows = await this.exsatApi.getTableRows(ContractName.blksync, synchronizer, 'blockbuckets', {
      fetch_all: true,
    });
    if (rows && rows.length > 0) {
      const heights: string = rows.map((item: any) => item.height).join(', ');
      logger.info(`[${caller}] all blockbuckets height: [${heights}]`);
      return rows.sort((a: any, b: any) => a.height - b.height);
    } else {
      logger.info(`[${caller}] no blockbuckets found`);
    }
    return rows;
  }

  /**
   * Retrieves consensus data for a block bucket by bucketId.
   * @param synchronizer - The synchronizer account name.
   * @param bucketId - The bucket ID.
   * @returns The consensus data or null if not found.
   */
  public async getConsensusByBucketId(synchronizer: string, bucketId: number): Promise<any> {
    const rows = await this.exsatApi.getTableRows(ContractName.utxomng, ContractName.utxomng, 'consensusblk', {
      index_position: IndexPosition.Primary,
      upper_bound: UInt64.from(bucketId),
      lower_bound: UInt64.from(bucketId),
      key_type: KeyType.I64,
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  /**
   * Retrieves consensus data for a block by blockId(height + hash).
   * @param height
   * @param hash
   */
  public async getConsensusByBlockId(height: bigint, hash: string): Promise<any> {
    const blockId = computeBlockId(height, hash);
    const rows = await this.exsatApi.getTableRows(ContractName.utxomng, ContractName.utxomng, 'consensusblk', {
      index_position: IndexPosition.Fifth,
      upper_bound: Checksum256.from(blockId),
      lower_bound: Checksum256.from(blockId),
      key_type: KeyType.Sha256,
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  /**
   * Retrieves the last consensus block.
   * @returns The last consensus block data or null if not found.
   */
  public async getLastConsensusBlock() {
    const rows = await this.exsatApi.getTableRows(ContractName.utxomng, ContractName.utxomng, 'consensusblk', {
      limit: 1,
      reverse: true,
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  /**
   * Retrieves the become validator quatos.
   * @returns The become validator quatos data or null if not found.
   */
  public async getActivateValidatorQuotas() {
    const rows = await this.exsatApi.getTableRows(ContractName.compete, ContractName.compete, 'globals', {
      limit: 1,
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }

  /**
   * Retrieves the validator acticed info.
   * @param validator
   */
  public async getValidatorActivatedInfo(validator: string) {
    const rows = await this.exsatApi.getTableRows(ContractName.compete, ContractName.compete, 'activations', {
      limit: 1,
      lower_bound: Name.from(validator),
      upper_bound: Name.from(validator),
    });
    if (rows && rows.length > 0) {
      return rows[0];
    }
    return null;
  }
}

export default TableApi;
