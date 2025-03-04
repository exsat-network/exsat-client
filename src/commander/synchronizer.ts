import {
  getErrorMessage,
  isValidEvmAddress,
  isValidUrl,
  reloadEnv,
  retry,
  showInfo,
  sleep,
  updateEnvFile,
} from '../utils/common';
import { EXSAT_RPC_URLS, NETWORK, NETWORK_CONFIG, SET_SYNCHRONIZER_DONATE_RATIO } from '../utils/config';
import { input, password, select, Separator } from '@inquirer/prompts';
import process from 'node:process';
import { getAccountInfo, getConfigPassword, getInputPassword } from '../utils/keystore';
import { Client, ClientType, ContractName, ErrorCode } from '../utils/enumeration';
import { logger } from '../utils/logger';
import ExsatApi from '../utils/exsat-api';
import TableApi from '../utils/table-api';
import fs from 'node:fs';
import { inputWithCancel } from '../utils/input';
import {
  checkAccountRegistrationStatus,
  checkExsatUrls,
  exportPrivateKey,
  notAccountMenu,
  resetBtcRpcUrl,
  setBtcRpcUrl,
} from './common';
import { Font } from '../utils/font';
import { getUserAccount } from './account';
import ExsatNode from '../utils/exsat-node';

export class SynchronizerCommander {
  private exsatAccountInfo: any;
  private synchronizerInfo: any;
  private tableApi: TableApi;
  private exsatApi: ExsatApi;
  private registion;
  constructor(exsatAccountInfo, retistion = false) {
    this.exsatAccountInfo = exsatAccountInfo;
    this.registion = retistion;
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

    // Initialize APIs and check account and synchronizer status
    await this.init();

    await checkAccountRegistrationStatus(this.exsatAccountInfo);
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
    const accountName = this.exsatAccountInfo.accountName;
    const btcBalance = await this.tableApi.getAccountBalance(accountName);
    const synchronizer = this.synchronizerInfo;

    const showMessageInfo = {
      'Account Name': accountName,
      Role: 'Synchronizer',
      'Public Key': this.exsatAccountInfo.publicKey,
      'Gas Balance': btcBalance ? btcBalance : `0.00000000 BTC`,
      'Reward Address': synchronizer.memo ?? synchronizer.reward_recipient,
      'BTC RPC Node': process.env.BTC_RPC_URL ?? '',
      'Eligible for Consensus': 'Yes',
    };
    showInfo(showMessageInfo);

    const menus = [
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
      revote: async () => await this.revoteForConsensus(),
      set_reward_address: async () => await this.setRewardAddress(),
      reset_btc_rpc: async () => await resetBtcRpcUrl(),
      export_private_key: async () => {
        return await exportPrivateKey(this.exsatAccountInfo.privateKey);
      },
      remove_account: async () => await this.removeKeystore(),
      quit: async () => process.exit(),
    };

    let action;
    do {
      action = await select({
        message: 'Select an Action',
        choices: menus,
        loop: false,
        pageSize: 20,
      });
      if (action !== '99') {
        await (actions[action] || (() => {}))();
      }
    } while (action !== '99');
  }

  /**
   * Removes the keystore file after confirming the password.
   */
  async removeKeystore() {
    try {
      await retry(async () => {
        const passwordInput = await password({
          message:
            'Enter your password to remove account\n(5 incorrect passwords will exit the program, Input "q" to return): ',
          mask: '*',
        });
        if (passwordInput === 'q') {
          return false;
        }
        await getAccountInfo(process.env.SYNCHRONIZER_KEYSTORE_FILE, passwordInput);
        fs.unlinkSync(process.env.SYNCHRONIZER_KEYSTORE_FILE);
        logger.info('Remove account successfully');
        process.exit();
      }, 5);
    } catch (e) {
      logger.error('Invalid password');
      process.exit();
    }
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
    const res: any = await this.exsatApi.executeAction(ContractName.poolreg, 'setdonate', data);
    if (res && res.transaction_id) {
      await this.updateSynchronizerInfo();
      logger.info(
        `${Font.fgCyan}${Font.bright}Set Donation Ratio: ${ratio}% successfully. ${Number(ratio) ? 'Thanks for your support.' : ''}${Font.reset}\n`
      );
      return true;
    } else {
      logger.error(`Synchronizer[${this.exsatAccountInfo.accountName}] Set Donation Ratio: ${ratio}% failed`);
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
    const res: any = await this.exsatApi.executeAction(ContractName.poolreg, 'setfinacct', data);
    if (res && res.transaction_id) {
      await this.updateSynchronizerInfo();
      return true;
    } else {
      logger.error(`Synchronizer[${this.exsatAccountInfo.accountName}] Set reward address: ${account} failed`);
      return false;
    }
  }

  /**
   * Decrypts the keystore and initializes exsatApi and tableApi.
   */
  async init() {
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
      console.log(
        `In order to activate your account, please contact our admin via email (${Font.fgCyan}${Font.bright}${NETWORK_CONFIG.contact}${Font.reset}).\n`
      );
      if (this.registion && process.env.SYNCHRONIZER_KEYSTORE_FILE === process.env.VALIDATOR_KEYSTORE_FILE) {
        updateEnvFile({ VALIDATOR_KEYSTORE_FILE: '', VALIDATOR_KEYSTORE_PASSWORD: '' });
      }
      process.exit(0);
    }
  }

  /**
   * Checks if the reward address is set for the synchronizer.
   */
  async checkRewardsAddress() {
    const accountName = this.exsatAccountInfo.accountName;
    const btcBalance = await this.tableApi.getAccountBalance(accountName);
    const synchronizer = this.synchronizerInfo;
    if (!synchronizer.memo) {
      logger.info('Reward address is not set.');
      showInfo({
        'Account Name': accountName,
        Role: 'Synchronizer',
        'Public Key': this.exsatAccountInfo.publicKey,
        'Gas Balance': btcBalance ? btcBalance : `0.00000000 BTC`,
        'Reward Address': 'unset',
        'BTC RPC Node': process.env.BTC_RPC_URL ?? '',
        'Eligible for Consensus': 'Yes',
      });

      const menus = [
        { name: 'Set Reward Address(EVM)', value: 'set_reward_address' },
        new Separator(),
        { name: 'Quit', value: 'quit', description: 'Quit' },
      ];

      const actions: { [key: string]: () => Promise<any> } = {
        set_reward_address: async () => await this.setRewardAddress(),
        quit: async () => process.exit(0),
      };
      let action;
      let res;
      do {
        action = await select({ message: 'Select an Action: ', choices: menus });
        res = await (actions[action] || (() => {}))();
      } while (!res);
    } else {
      logger.info('Reward Address is already set correctly.');
    }
  }

  /**
   * Checks if the BTC RPC URL is set and valid.
   */
  async checkBtcRpcNode() {
    const rpcUrl = process.env.BTC_RPC_URL;
    const accountName = this.exsatAccountInfo.accountName;
    const btcBalance = await this.tableApi.getAccountBalance(accountName);
    const synchronizer = this.synchronizerInfo;
    if (!rpcUrl || !isValidUrl(rpcUrl)) {
      logger.info('BTC_RPC_URL is not set or is in an incorrect format.');
      const showMessageInfo = {
        'Account Name': accountName,
        'Public Key': this.exsatAccountInfo.publicKey,
        'Gas Balance': btcBalance ? btcBalance : `0.00000000 BTC`,
        'Reward Address': synchronizer.memo ?? synchronizer.reward_recipient,
        'BTC RPC Node': 'unset',
        'Eligible for Consensus': 'Yes',
      };
      showInfo(showMessageInfo);

      const menus = [
        { name: 'Set BTC RPC Node', value: 'set_btc_node' },
        new Separator(),
        { name: 'Quit', value: 'quit', description: 'Quit' },
      ];

      const actions: { [key: string]: () => Promise<any> } = {
        set_btc_node: async () => await setBtcRpcUrl(),
        quit: async () => process.exit(0),
      };
      let action;
      let res;
      do {
        action = await select({ message: 'Select an Action: ', choices: menus });
        res = await (actions[action] || (() => {}))();
      } while (!res);
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
}
