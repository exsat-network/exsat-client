import fetch from 'node-fetch';
import { API, APIClient, Chains, Session } from '@wharfkit/session';
import { logger } from './logger';
import process from 'process';
import axios from 'axios';
import moment from 'moment';
import { getAmountFromQuantity } from './common';
import { Client, ClientType, ContractName, IndexPosition } from './enumeration';
import { Version } from './version';
import { WalletPluginPrivateKey } from '@wharfkit/wallet-plugin-privatekey';
import { RES_PERMISSION } from './config';

class ExsatApi {
  private api: APIClient;
  private session: Session;
  private walletPlugin: WalletPluginPrivateKey;
  private nodes: string[];
  private currentNodeIndex: number;
  private accountName: string;
  private maxRetries: number = 3;
  private retryDelay: number = 1000;
  private executeActions: number = 0;
  private chainId: string;

  /**
   * Constructor initializes the API with account information and node list.
   * @param accountInfo - The account name and private key.
   * @param nodes - List of nodes to connect to.
   */
  constructor(
    private accountInfo: {
      accountName: string;
      privateKey: string;
    },
    nodes: string[]
  ) {
    this.nodes = nodes;
    this.currentNodeIndex = 0;
    this.accountName = accountInfo.accountName;
    this.walletPlugin = new WalletPluginPrivateKey(accountInfo.privateKey);
  }

  /**
   * Initializes the API by finding a valid node and setting up RPC and API objects.
   */
  public async initialize(): Promise<void> {
    const validNodeFound = await this.findValidNode();
    if (!validNodeFound) {
      throw new Error('No valid exsat node available.');
    }
    this.session = new Session(
      {
        chain: {
          id: this.chainId,
          url: this.getCurrentNode(),
        },
        actor: this.accountName,
        permission: 'active',
        walletPlugin: this.walletPlugin,
      },
      {
        fetch,
      }
    );

    logger.info('ExsatApi initialized successfully.');
  }

  /**
   * Returns the currently active node URL.
   * @returns The current node URL.
   */
  private getCurrentNode(): string {
    return this.nodes[this.currentNodeIndex];
  }

  /**
   * Iterates through nodes to find a valid one.
   * @returns Boolean indicating if a valid node was found.
   */
  private async findValidNode(): Promise<boolean> {
    for (let i = 0; i < this.nodes.length; i++) {
      this.currentNodeIndex = i;
      const valid = await this.isValidNode(this.getCurrentNode());
      if (valid) {
        logger.info(`Using node: ${this.getCurrentNode()}`);
        return true;
      }
    }
    return false;
  }

  /**
   * Switches to the next available node if the current one is invalid.
   * @param attemptCount - The number of attempts made to switch nodes.
   * @returns Boolean indicating if the switch was successful.
   */
  private async switchNode(attemptCount: number = 0): Promise<boolean> {
    if (this.nodes.length <= 1 || attemptCount >= this.nodes.length) {
      return false;
    }

    this.currentNodeIndex = (this.currentNodeIndex + 1) % this.nodes.length;
    const valid = await this.isValidNode(this.getCurrentNode());

    if (valid) {
      this.session = new Session(
        {
          chain: {
            id: Chains.EOS.id,
            url: this.getCurrentNode(),
          },
          actor: this.accountName,
          permission: 'active',
          walletPlugin: this.walletPlugin,
        },
        {
          fetch,
        }
      );
      logger.info(`Switched to node: ${this.getCurrentNode()}`);
      return true;
    }

    return this.switchNode(attemptCount + 1);
  }

  /**
   * Validates if a node is responsive and synchronized with the network.
   * @param url - The node URL to validate.
   * @returns Boolean indicating if the node is valid.
   */
  private async isValidNode(url: string) {
    try {
      const response = await axios.get(`${url}/v1/chain/get_info`, {
        timeout: 3000,
      });
      if (response.status === 200 && response.data) {
        this.chainId = response.data.chain_id;
        const diffMS: number =
          moment(response.data.head_block_time).diff(moment().valueOf()) + moment().utcOffset() * 60_000;
        return Math.abs(diffMS) <= 300_000;
      }
    } catch (e) {
      logger.error(`getInfo from exsat rpc error: [${url}]`);
    }
    return false;
  }

  /**
   * Retries an operation with exponential backoff and switches nodes on failure.
   * @param operation - The operation to retry.
   * @param retryCount - The current retry attempt count.
   * @returns The result of the operation.
   */
  private async retryWithExponentialBackoff<T>(operation: () => Promise<T>, retryCount: number = 0): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (retryCount >= this.maxRetries) {
        throw error;
      }

      const delay = this.retryDelay * Math.pow(2, retryCount);
      logger.warn(`Operation failed, retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));

      const switchResult = await this.switchNode();
      if (!switchResult) {
        throw new Error('All nodes are invalid');
      }

      return this.retryWithExponentialBackoff(operation, retryCount + 1);
    }
  }

  /**
   * Executes a exsat action and handles potential errors and retries.
   * @param account - The account to execute the action on.
   * @param name - The name of the action to execute.
   * @param data - The data to send with the action.
   * @param showLog
   * @returns The result of the transaction.
   */
  public async executeAction(account: string, name: string, data: any, showLog = true) {
    const packageVersion = await Version.getLocalVersion();
    let resPermission = packageVersion.startsWith('1.0') ? 'active' : 'res';
    if (RES_PERMISSION) {
      resPermission = RES_PERMISSION;
    }
    const authorization = [
      {
        actor: ContractName.res,
        permission: resPermission,
      },
      {
        actor: this.accountName,
        permission: 'active',
      },
    ];
    try {
      const result = await this.session.transact(
        {
          actions: [
            {
              account,
              name,
              authorization,
              data,
            },
          ],
        },
        {
          expireSeconds: 30,
        }
      );
      // logger.info(`Execute actions: ${this.executeActions++}`);
      return result;
    } catch (e: any) {
      let dataStr = JSON.stringify(data);
      dataStr = dataStr.length > 500 ? dataStr.substring(0, 500) + '...' : dataStr;
      if (showLog) {
        logger.info(`Transaction result, account: ${account}, name: ${name}, data: ${dataStr}`, e);
      }
      throw e;
    }
  }

  /**
   * Checks if the client is properly configured and authorized.
   * @param type - The type of client (e.g., Synchronizer or Validator).
   */
  public async checkClient(type: number) {
    const clientType = type === ClientType.Synchronizer ? 'Synchronizer' : 'Validator';
    try {
      const version = await Version.getLocalVersion();
      const result = await this.executeAction(ContractName.rescmng, 'checkclient', {
        client: this.accountName,
        type,
        version,
      });
      const returnValueData = result.response.processed.action_traces[0].return_value_data;
      if (!returnValueData.has_auth) {
        logger.error(
          `The account[${this.accountName}] permissions do not match. Please check if the keystore file[${process.env.KEYSTORE_FILE}] has been imported correctly`
        );
        process.exit(1);
      }
      if (!returnValueData.is_exists) {
        logger.error(
          `The account[${this.accountName}] has not been registered as a ${clientType}. Please contact the administrator for verification`
        );
        process.exit(1);
      }
      const balance = getAmountFromQuantity(returnValueData.balance);
      if (balance < 0.0001) {
        logger.error(
          `The account[${this.accountName}] gas fee balance[${balance}] is insufficient. Please recharge through the menu`
        );
        process.exit(1);
      }
    } catch (e) {
      logger.error(`${clientType}[${this.accountName}] client configurations are incorrect, and the startup failed`, e);
      process.exit(1);
    }
    logger.info(`${clientType}[${this.accountName}] client configurations are correct, and the startup was successful`);
  }

  public async heartbeat(type: number) {
    const clientType = type === ClientType.Synchronizer ? Client.Synchronizer : Client.Validator;
    try {
      const version = await Version.getLocalVersion();
      const result = await this.executeAction(ContractName.rescmng, 'checkclient', {
        client: this.accountName,
        type,
        version,
      });
      const returnValueData = result.response.processed.action_traces[0].return_value_data;
      if (!returnValueData.has_auth) {
        logger.error(
          `The account[${this.accountName}] permissions do not match. Please check if the keystore file[${process.env.KEYSTORE_FILE}] has been imported correctly`
        );
        process.exit(1);
      }
      if (!returnValueData.is_exists) {
        logger.error(
          `The account[${this.accountName}] has not been registered as a ${clientType}. Please contact the administrator for verification`
        );
        process.exit(1);
      }
      const balance = getAmountFromQuantity(returnValueData.balance);
      if (balance < 0.0001) {
        logger.warn(
          `The account[${this.accountName}] gas fee balance[${balance}] is insufficient. Please recharge through the menu`
        );
      }
    } catch (e) {
      logger.error(`${clientType}[${this.accountName}] client heartbeat failed`, e);
    }
  }

  /**
   * Retrieves rows from a table, with support for pagination and retry logic.
   * @param code - The smart contract to query.
   * @param scope - The account to query within the contract.
   * @param table - The table name to query.
   * @param options - Query options, including pagination.
   * @returns The rows retrieved from the table.
   */
  public async getTableRows<T>(
    code: string,
    scope: string | number,
    table: string,
    options: {
      limit?: number;
      lower_bound?: API.v1.TableIndexType;
      upper_bound?: API.v1.TableIndexType;
      index_position?:
        | IndexPosition.Primary
        | IndexPosition.Secondary
        | IndexPosition.Tertiary
        | IndexPosition.Fourth
        | IndexPosition.Fifth
        | IndexPosition.Sixth
        | IndexPosition.Seventh
        | IndexPosition.Eighth
        | IndexPosition.Ninth
        | IndexPosition.Tenth;
      key_type?: keyof API.v1.TableIndexTypes;
      reverse?: boolean;
      fetch_all?: boolean;
    } = {
      fetch_all: false,
    }
  ): Promise<T[]> {
    return this.retryWithExponentialBackoff(async () => {
      let rows: T[] = [];
      let lower_bound = options.lower_bound;
      let more = true;

      do {
        const result = await this.session.client.v1.chain.get_table_rows({
          json: true,
          code,
          scope: String(scope),
          table,
          limit: options.limit || 10,
          lower_bound: lower_bound,
          upper_bound: options.upper_bound,
          index_position: options.index_position,
          key_type: options.key_type,
          reverse: false,
          show_payer: false,
        });

        rows = rows.concat(result.rows as T[]);
        more = result.more;
        if (more && options.fetch_all) {
          lower_bound = result.next_key as API.v1.TableIndexType;
        } else {
          more = false;
        }
      } while (more && options.fetch_all);
      return rows;
    });
  }
}

export default ExsatApi;
