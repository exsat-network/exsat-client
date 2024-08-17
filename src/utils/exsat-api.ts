import { Api, JsonRpc, RpcError } from 'eosjs';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import fetch from 'node-fetch';
import { TextDecoder, TextEncoder } from 'util';
import { logger } from './logger';
import process from 'process';

class ExsatApi {
  private api: Api;
  private rpc: JsonRpc;
  private signatureProvider: JsSignatureProvider;
  private nodes: string[];
  private currentNodeIndex: number;
  private accountName: string;

  constructor(private accountInfo: {
    accountName: string;
    privateKey: string;
  }, nodes: string[]) {
    this.nodes = nodes;
    this.currentNodeIndex = 0;
    this.accountName = accountInfo.accountName;
    this.signatureProvider = new JsSignatureProvider([accountInfo.privateKey]);
    this.rpc = new JsonRpc(this.getCurrentNode(), { fetch });

    this.api = new Api({
      rpc: this.rpc,
      signatureProvider: this.signatureProvider,
      textDecoder: new TextDecoder(),
      textEncoder: new TextEncoder(),
    });
  }

  private getCurrentNode(): string {
    return this.nodes[this.currentNodeIndex];
  }

  private switchNode() {
    this.currentNodeIndex = (this.currentNodeIndex + 1) % this.nodes.length;
    this.rpc = new JsonRpc(this.getCurrentNode(), { fetch });
    this.api = new Api({
      rpc: this.rpc,
      signatureProvider: this.signatureProvider,
      textDecoder: new TextDecoder(),
      textEncoder: new TextEncoder(),
    });
    logger.info(`Switched to node: ${this.getCurrentNode()}`);
  }

  public async executeAction(account: string, name: string, data: any) {
    const authorization = [{
      actor: this.accountName,
      permission: 'active',
    }];
    try {
      const result = await this.api.transact({
        actions: [{
          account,
          name,
          authorization,
          data,
        }]
      }, {
        blocksBehind: 3,
        expireSeconds: 30,
      });

      logger.info('Transaction successful:', result);
      return result;
    } catch (e) {
      if (e instanceof RpcError) {
        logger.error('Transaction failed:', JSON.stringify(e.json, null, 2));
      } else {
        logger.error('Unexpected error:', e);
      }

      // Switch nodes and try again
      this.switchNode();
      return this.executeAction(account, name, data);
    }
  }

  public async checkClient(type: number) {
    try {
      const result = await this.executeAction('rescmng.xsat', 'checkclient', {
        client: this.accountName,
        type,
      });
      const returnValueData = result?.processed.action_traces[0]?.return_value_data;
      if (!returnValueData.has_auth) {
        logger.error(`The account[${this.accountName}] permissions do not match. Please check if the keystore file[${process.env.KEYSTORE_FILE}] has been imported correctly.`);
        process.exit(1);
      }
      if (!returnValueData.is_exists) {
        logger.error(`The account[${this.accountName}] has not been registered as a validator. Please contact the administrator for verification.`);
        process.exit(1);
      }
      const balance = Number(returnValueData.balance.split(' ')[0]);
      if (balance && balance < 0.0001) {
        logger.error(`The account[${this.accountName}] gas fee balance[${result.balance}] is insufficient. Please recharge through the menu.`);
        process.exit(1);
      }
    } catch (e) {
      logger.error(`Validator client configurations are incorrect, and the startup failed.`, e);
      process.exit(1);
    }
    logger.info('Validator client configurations are correct, and the startup was successful.');
  }

  public async getTableRows<T>(code: string, scope: string | number, table: string, options: {
    limit?: number;
    lower_bound?: string;
    upper_bound?: string;
    index_position?: string;
    key_type?: string;
    fetch_all?: boolean;
  } = {
    fetch_all: false
  }): Promise<T[]> {
    try {
      let rows: T[] = [];
      let lower_bound = options.lower_bound || '';
      let more = true;

      do {
        const result = await this.rpc.get_table_rows({
          json: true,
          code,
          scope,
          table,
          limit: options.limit || 10,
          lower_bound,
          upper_bound: options.upper_bound,
          index_position: options.index_position,
          key_type: options.key_type,
          reverse: false,
          show_payer: false
        });

        rows = rows.concat(result.rows as T[]);
        more = result.more;
        if (more && options.fetch_all) {
          lower_bound = result.next_key;
        } else {
          more = false;
        }

      } while (more && options.fetch_all);
      return rows;
    } catch (e) {
      logger.error(`Failed to fetch table rows, code=${code}, scope=${scope}, table=${table}`, e);

      // Switch nodes and try again
      this.switchNode();
      return this.getTableRows(code, scope, table, options);
    }
  }

}

export default ExsatApi;
