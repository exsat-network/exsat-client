import axios from 'axios';
import moment from 'moment';
import { logger } from './logger';
import { EXSAT_RPC_URLS } from './config';
import { getRpcUrls, isValidUrl } from './common';

class ExsatNode {
  private nodes: string[];
  private currentNodeIndex: number = 0;
  private chainId: string;

  constructor(nodes?: string[]) {
    if (nodes && nodes.length > 0 && isValidUrl(nodes[0])) {
      this.nodes = nodes;
    }
    this.nodes = EXSAT_RPC_URLS;
  }

  /**
   * Finds a valid node from the list.
   * @returns Boolean indicating if a valid node was found.
   */
  public async findValidNode(): Promise<boolean> {
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
   * Returns the currently active node URL.
   * @returns The current node URL.
   */
  public getCurrentNode(): string {
    return this.nodes[this.currentNodeIndex];
  }

  /**
   * Switches to the next available node if the current one is invalid.
   * @param attemptCount - The number of attempts made to switch nodes.
   * @returns Boolean indicating if the switch was successful.
   */
  public async switchNode(attemptCount: number = 0): Promise<boolean> {
    if (attemptCount >= this.nodes.length) {
      return false;
    }

    this.currentNodeIndex = (this.currentNodeIndex + 1) % this.nodes.length;
    const valid = await this.isValidNode(this.getCurrentNode());

    if (valid) {
      logger.info(`Switched to node: ${this.getCurrentNode()}`);
      return true;
    }

    return await this.switchNode(attemptCount + 1);
  }

  /**
   * Validates if a node is responsive and synchronized with the network.
   * @param url - The node URL to validate.
   * @returns Boolean indicating if the node is valid.
   */
  private async isValidNode(url: string): Promise<boolean> {
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

  public getChainId(): string {
    return this.chainId;
  }
}

export default ExsatNode;
