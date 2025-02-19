import { getErrorMessage, isValidUrl, reloadEnv, retry, showInfo, sleep, updateEnvFile } from '../utils/common';
import { EXSAT_RPC_URLS, NETWORK_CONFIG, SET_SYNCHRONIZER_DONATE_RATIO } from '../utils/config';
import { input, password, select, Separator } from '@inquirer/prompts';
import process from 'node:process';
import { getAccountInfo, getConfigPassword, getInputPassword } from '../utils/keystore';
import { Client, ClientType, ContractName, ErrorCode } from '../utils/enumeration';
import { logger } from '../utils/logger';
import ExsatApi from '../utils/exsat-api';
import TableApi from '../utils/table-api';
import fs from 'node:fs';
import { inputWithCancel } from '../utils/input';
import { checkExsatUrls, exportPrivateKey, notAccountMenu, resetBtcRpcUrl, setBtcRpcUrl } from './common';
import { Font } from '../utils/font';
import { getUserAccount } from './account';

export class SynchronizerCommander {
  private exsatAccountInfo: any;
  private synchronizerInfo: any;
  private tableApi: TableApi;
  private exsatApi: ExsatApi;

  /**
   * Main entry point for the SynchronizerCommander.
   * Checks the keystore, initializes APIs, and manages the synchronizer menu.
   */
  async main() {
    // Check if keystore exists
    while (!fs.existsSync(process.env.SYNCHRONIZER_KEYSTORE_FILE)) {
      await notAccountMenu(Client.Synchronizer);
      reloadEnv();
    }

    // Initialize APIs and check account and synchronizer status
    await this.init();

    await this.checkAccountRegistrationStatus();
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
      set_donation_ratio: async () => await this.setDonationRatio(),
      purchase_memory_slot: async () => await this.purchaseSlots(),
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
   * Purchases memory slots for the synchronizer.
   */
  async purchaseSlots() {
    const numberSlots = await inputWithCancel('Input number of slots(Input "q" to return): ', (value) => {
      const num = Number(value);
      if (!Number.isInteger(num) || num < 1) {
        return 'Please enter a valid number more than 0';
      }
      return true;
    });
    if (!numberSlots) {
      return;
    }

    await this.buySlots(parseInt(numberSlots));
    logger.info(`Buy slots: ${numberSlots} successfully`);
  }

  /**
   * Sets the reward address for the synchronizer.
   */
  async setRewardAddress() {
    const financialAccount = await inputWithCancel('Enter reward address(Input "q" to return): ', (input: string) => {
      if (!/^0x[a-fA-F0-9]{40}$/.test(input)) {
        return 'Please enter a valid account name.';
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
   * Buys memory slots for the synchronizer.
   */
  async buySlots(slots: number) {
    const data = {
      synchronizer: this.exsatAccountInfo.accountName,
      receiver: this.exsatAccountInfo.accountName,
      num_slots: slots,
    };

    const res: any = await this.exsatApi.executeAction(ContractName.poolreg, 'buyslot', data);
    if (res && res.transaction_id) {
      await this.updateSynchronizerInfo();
      return true;
    } else {
      logger.error(`Synchronizer[${this.exsatAccountInfo.accountName}] Buy slots: ${slots} failed`);
      return false;
    }
  }

  /**
   * Decrypts the keystore and initializes exsatApi and tableApi.
   */
  async init() {
    this.exsatAccountInfo = await this.decryptKeystore();
    await checkExsatUrls();
    this.exsatApi = new ExsatApi(this.exsatAccountInfo, EXSAT_RPC_URLS);
    await this.exsatApi.initialize();
    this.tableApi = new TableApi(this.exsatApi);
  }

  /**
   * Decrypts the keystore file to retrieve account information.
   */
  async decryptKeystore() {
    let password = getConfigPassword(ClientType.Synchronizer);
    let accountInfo;
    if (password) {
      password = password.trim();
      accountInfo = await getAccountInfo(process.env.SYNCHRONIZER_KEYSTORE_FILE, password);
    } else {
      while (!accountInfo) {
        try {
          password = await getInputPassword();
          if (password === 'q') {
            process.exit(0);
          }
          accountInfo = await getAccountInfo(process.env.SYNCHRONIZER_KEYSTORE_FILE, password);
        } catch (e) {
          logger.warn(e);
        }
      }
    }
    return accountInfo;
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
      process.exit(0);
    }
  }

  /**
   * Checks the registration status of the account.
   */
  async checkAccountRegistrationStatus() {
    const checkAccountInfo = await getUserAccount(this.exsatAccountInfo.accountName);
    if (!checkAccountInfo) {
      showInfo({
        'Account Name': this.exsatAccountInfo.accountName,
        'Public Key': this.exsatAccountInfo.publicKey,
        'Registration Url': `${NETWORK_CONFIG.register}/${btoa(`account=${this.exsatAccountInfo.accountName}&pubkey=${this.exsatAccountInfo.publicKey}&role=${this.exsatAccountInfo.role}`)}`,
      });
      console.log(
        `Please note that your registration has not finished yet!\n${Font.fgGreen}${Font.bright}Please copy the Registration Url above and paste to your browser to finish the registration.${Font.reset}`
      );
      process.exit(0);
    }
    return true;
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
   * Checks if the donate setting is set for the synchronizer.
   */
  async checkDonateSetting() {
    if (!this.synchronizerInfo.donate_rate && !SET_SYNCHRONIZER_DONATE_RATIO) {
      console.log(
        `\n${Font.fgCyan}${Font.bright}You haven't set the donation ratio yet. Please set it first.${Font.reset}`
      );
      await this.setDonationRatio();
      updateEnvFile({ SET_SYNCHRONIZER_DONATE_RATIO: true });
    }
    return true;
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
