import {
  getErrorMessage,
  isValidEvmAddress,
  isValidUrl,
  reloadEnv,
  removeTrailingZeros,
  showInfo,
  sleep,
  updateEnvFile,
} from '../utils/common';
import { NETWORK_CONFIG } from '../utils/config';
import { input, select, Separator } from '@inquirer/prompts';
import process from 'node:process';
import { Client, ClientType, ContractName, ErrorCode } from '../utils/enumeration';
import { logger } from '../utils/logger';
import ExsatApi from '../utils/exsat-api';
import TableApi from '../utils/table-api';
import fs from 'node:fs';
import { inputWithCancel } from '../utils/input';
import {
  checkAccountRegistrationStatus,
  decryptKeystore,
  exportPrivateKey,
  notAccountMenu,
  promptMenuLoop,
  removeKeystore,
  resetBtcRpcUrl,
  setBtcRpcUrl,
  stakeClaimManagement,
} from './common';
import { Font } from '../utils/font';

export class SynchronizerCommander {
  private exsatAccountInfo: any;
  private synchronizerInfo: any;
  private tableApi: TableApi;
  private exsatApi: ExsatApi;
  private registration: boolean;

  constructor(registration = false) {
    this.registration = registration;
  }

  /**
   * Main entry point for the SynchronizerCommander.
   * Checks the keystore, initializes APIs, and manages the synchronizer menu.
   */
  async main() {
    // Check if keystore exists
    while (!fs.existsSync(process.env.SYNCHRONIZER_KEYSTORE_FILE)) {
      await notAccountMenu();
      reloadEnv();
    }
    await checkAccountRegistrationStatus(ClientType.Synchronizer);

    // Initialize APIs and check account and synchronizer status
    await this.init();

    await this.checkSynchronizerRegistrationStatus();
    await this.checkRewardsAddress();
    // await this.checkDonateSetting();
    await this.checkBtcRpcNode();

    // Display the main manager menu
    await this.managerMenu();
  }

  /**
   * Displays the main manager menu with various options for the synchronizer.
   */
  async managerMenu() {
    const synchronizer = this.synchronizerInfo;
    // Get the showMessageInfo
    const showMessageInfo = await this.getShowMessageInfo(synchronizer);
    showInfo(showMessageInfo);

    const menus = [
      {
        name: 'Stake or Claim Management',
        value: 'stake_claim_management',
        description: 'A Link To Stake or Claim Management',
      },
      {
        name: synchronizer?.reward_recipient ? 'Change Reward Address' : 'Set Reward Address',
        value: 'set_reward_address',
        description: 'Set/Change Reward Address',
        disabled: !synchronizer,
      },
      {
        name: 'Revote For Consensus',
        value: 'revote',
        description: 'Revote For Consensus',
        disabled: !synchronizer,
      },
      {
        name: 'Change BTC RPC Node',
        value: 'reset_btc_rpc',
        description: 'Change BTC RPC Node',
      },
      {
        name: 'Export Private Key',
        value: 'export_private_key',
        description: 'Export Private Key',
      },
      {
        name: 'Remove Account',
        value: 'remove_account',
        description: 'Remove Account',
      },
      new Separator(),
      { name: 'Quit', value: 'quit', description: 'Quit' },
    ];

    const actions: { [key: string]: () => Promise<any> } = {
      stake_claim_management: async () => await stakeClaimManagement(Client.Synchronizer),
      revote: async () => await this.revoteForConsensus(),
      set_reward_address: async () => await this.setRewardAddress(),
      reset_btc_rpc: async () => await resetBtcRpcUrl(),
      export_private_key: async () => {
        return await exportPrivateKey(this.exsatAccountInfo.privateKey);
      },
      remove_account: async () => await removeKeystore(ClientType.Synchronizer),
      quit: async () => process.exit(),
    };
    await promptMenuLoop(menus, actions, 'Select an Action', true);
  }

  /**
   * Sets the reward address for the synchronizer.
   */
  async setRewardAddress() {
    const financialAccount = await inputWithCancel('Enter reward address(Input "q" to return): ', (input: string) => {
      if (!isValidEvmAddress(input)) {
        return 'Please enter a valid address.';
      }
      return true;
    });
    if (!financialAccount) {
      return false;
    }
    await this.resetRewardAddress(financialAccount);
    logger.info(`Set reward address: ${financialAccount} successfully`);
    return true;
  }

  async setDonationRatio() {
    const ratio = await inputWithCancel('Enter donation ratio(0.00-100.00, Input "q" to return): ', (value) => {
      //Determine whether it is a number between 0.00-100.00
      const num = parseFloat(value);
      // Check if it is a valid number and within the range
      if (!isNaN(num) && num >= 0 && num <= 100 && /^\d+(\.\d{1,2})?$/.test(value)) {
        return true;
      }
      return 'Please enter a valid number between 0.00 and 100.00';
    });
    if (!ratio) {
      return false;
    }
    const data = {
      synchronizer: this.exsatAccountInfo.accountName,
      donate_rate: parseFloat(ratio) * 100,
    };
    try {
      await this.exsatApi.executeAction(ContractName.poolreg, 'setdonate', data);
      await this.updateSynchronizerInfo();
      logger.info(
        `${Font.fgCyan}${Font.bright}Set Donation Ratio: ${ratio}% successfully. ${Number(ratio) ? 'Thanks for your support.' : ''}${Font.reset}\n`
      );
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Resets the reward address for the synchronizer.
   */
  async resetRewardAddress(account: string) {
    const data = {
      synchronizer: this.exsatAccountInfo.accountName,
      financial_account: account,
    };
    try {
      await this.exsatApi.executeAction(ContractName.poolreg, 'setfinacct', data);
      await this.updateSynchronizerInfo();
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Decrypts the keystore and initializes exsatApi and tableApi.
   */
  async init() {
    this.exsatAccountInfo = await decryptKeystore(ClientType.Synchronizer);
    this.exsatApi = new ExsatApi(this.exsatAccountInfo);
    await this.exsatApi.initialize();
    this.tableApi = await TableApi.getInstance();
  }

  /**
   * Checks the registration status of the synchronizer.
   */
  async checkSynchronizerRegistrationStatus() {
    const synchronizerInfo = await this.tableApi.getSynchronizerInfo(this.exsatAccountInfo.accountName);
    if (synchronizerInfo) {
      this.synchronizerInfo = synchronizerInfo;
      return true;
    } else {
      if (this.registration) {
        const validatorInfo = await this.tableApi.getValidatorInfo(this.exsatAccountInfo.accountName);
        if (!validatorInfo) {
          updateEnvFile({ VALIDATOR_KEYSTORE_FILE: '', VALIDATOR_KEYSTORE_PASSWORD: '' });
        }
      }
      showInfo({
        'Please note':
          'In order to complete your registration, please follow the actions from the "Synchronizer Registration" page below.',
        'Page Url': NETWORK_CONFIG.synchronizerRegistration,
      });
      process.exit(0);
    }
  }

  /**
   * Checks if the reward address is set for the synchronizer.
   */
  async checkRewardsAddress() {
    if (!this.synchronizerInfo.memo) {
      logger.info('Reward address is not set.');
      await this.handleMissingSetting('Reward Address', 'set_reward_address');
    } else {
      logger.info('Reward Address is already set correctly.');
    }
  }

  /**
   * Checks if the BTC RPC URL is set and valid.
   */
  async checkBtcRpcNode() {
    const rpcUrl = process.env.BTC_RPC_URL;
    if (!rpcUrl || !isValidUrl(rpcUrl)) {
      logger.info('BTC_RPC_URL is not set or is in an incorrect format.');
      await this.handleMissingSetting('BTC RPC Node', 'set_btc_rpc');
    } else {
      logger.info('BTC_RPC_URL is already set correctly.');
    }
  }

  async updateSynchronizerInfo() {
    await sleep(1000);
    this.synchronizerInfo = await this.tableApi.getSynchronizerInfo(this.exsatAccountInfo.accountName);
  }

  async revoteForConsensus() {
    const height = await inputWithCancel(
      'Enter the height you want to revote for(Input "q" to return): ',
      async (value) => {
        const num = parseInt(value.trim());
        if (isNaN(num)) {
          return 'Please enter a valid number.';
        }
        let irreversibleHeight = (await this.tableApi.getChainstate()).irreversible_height;
        if (num <= irreversibleHeight || num > irreversibleHeight + 7) {
          return `Please enter a height between ${irreversibleHeight + 1} and ${irreversibleHeight + 7}.`;
        }
        return true;
      }
    );
    if (!height) return false;
    const data = {
      synchronizer: this.exsatAccountInfo.accountName,
      height: parseInt(height),
    };
    try {
      const res: any = await this.exsatApi.executeAction(ContractName.blkendt, 'revote', data, false);
      await input({ message: `Revote successfully at height: ${data.height}, press [Enter] to continue...` });
      return res;
    } catch (e: any) {
      const errorMessage = getErrorMessage(e);
      if (errorMessage.startsWith(ErrorCode.Code2006) || errorMessage.startsWith(ErrorCode.Code2007)) {
        console.error(errorMessage);
        return true;
      } else {
        logger.info(
          `Transaction result, account: ${ContractName.blkendt}, name: 'revote', data: ${JSON.stringify(data)}`,
          e
        );
        throw e;
      }
    }
  }

  /**
   * Get the show message info.
   * @private
   * @param synchronizer
   */
  private async getShowMessageInfo(synchronizer) {
    const accountName = this.exsatAccountInfo.accountName;
    const btcBalance = await this.tableApi.getAccountBalance(accountName);
    return {
      'Account Name': accountName,
      Role: 'Synchronizer',
      'Public Key': this.exsatAccountInfo.publicKey,
      'Gas Balance': btcBalance ? removeTrailingZeros(btcBalance) : `0 BTC`,
      'Reward Address': synchronizer.memo || 'Unset',
      'BTC RPC Node': isValidUrl(process.env.BTC_RPC_URL) ? process.env.BTC_RPC_URL : 'Invalid',
      'Eligible for Consensus': 'Yes',
    };
  }

  /**
   * Handles missing settings for a validator.
   * @param settingName
   * @param actionKey
   * @private
   */
  private async handleMissingSetting(settingName: string, actionKey: string) {
    let showMessageInfo = await this.getShowMessageInfo(this.synchronizerInfo);
    showInfo(showMessageInfo);

    const menus = [
      { name: `Set ${settingName}`, value: actionKey },
      new Separator(),
      { name: 'Quit', value: 'quit', description: 'Quit' },
    ];

    const actions: { [key: string]: () => Promise<any> } = {
      set_btc_rpc: async () => await setBtcRpcUrl(),
      set_reward_address: async () => await this.setRewardAddress(),
      quit: async () => process.exit(0),
    };
    await promptMenuLoop(menus, actions, 'Select an Action');
  }
}
