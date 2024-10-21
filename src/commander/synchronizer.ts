import { Version } from '../utils/version';
import { isValidUrl, reloadEnv, retry, showInfo, sleep } from '../utils/common';
import { EXSAT_RPC_URLS, SET_SYNCHRONIZER_DONATE_RATIO } from '../utils/config';
import { input, password, select, Separator, confirm } from '@inquirer/prompts';
import { chargeBtcForResource, chargeForRegistry, checkUsernameWithBackend } from '@exsat/account-initializer';
import process from 'node:process';
import { getAccountInfo, getConfigPassword, getInputPassword } from '../utils/keystore';
import { Client, ClientType } from '../utils/enumeration';
import { logger } from '../utils/logger';
import ExsatApi from '../utils/exsat-api';
import TableApi from '../utils/table-api';
import fs from 'node:fs';
import { inputWithCancel } from '../utils/input';
import { updateEnvFile } from '@exsat/account-initializer/dist/utils';
import { checkExsatUrls, notAccountMenu, updateMenu } from './common';
import { Font } from '../utils/font';
import { changeEmail } from '@exsat/account-initializer/dist/accountInitializer';

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
    await this.checkDonateSetting();
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
      'BTC Balance Used for Gas Fee': btcBalance,
      'Reward Address': synchronizer.memo ?? synchronizer.reward_recipient,
      'Donate Ratio': `${synchronizer.donate_rate / 100}%` ?? '0%',
      'BTC PRC Node': process.env.BTC_RPC_URL ?? '',
      'Account Registration Status': 'Registered',
      'Synchronizer Registration Status': 'Registered',
      Email: this.exsatAccountInfo.email,
      'Memory Slot': synchronizer.num_slots,
    };
    showInfo(showMessageInfo);

    const menus = [
      {
        name: 'Bridge BTC as GAS Fee',
        value: 'recharge_btc',
        description: 'Bridge BTC as GAS Fee',
      },
      {
        name: synchronizer?.reward_recipient ? 'Change Reward Address' : 'Set Reward Address',
        value: 'set_reward_address',
        description: 'Set/Change Reward Address',
        disabled: !synchronizer,
      },
      {
        name: `${synchronizer?.donate_rate ? 'Change' : 'Set'} Donation Ratio`,
        value: 'set_donation_ratio',
        description: 'Set/Change Donation Ratio',
        disabled: !synchronizer,
      },
      {
        name: 'Purchase Memory Slot',
        value: 'purchase_memory_slot',
        description: 'Purchase Memory Slot',
        disabled: !synchronizer,
      },
      {
        name: 'Change BTC RPC Node',
        value: 'reset_btc_rpc',
        description: 'Change BTC RPC Node',
      },
      {
        name: 'Change Email',
        value: 'change_email',
        description: 'Change Email',
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
      recharge_btc: async () => await chargeBtcForResource(process.env.SYNCHRONIZER_KEYSTORE_FILE),
      set_reward_address: async () => await this.setRewardAddress(),
      set_donation_ratio: async () => await this.setDonationRatio(),
      purchase_memory_slot: async () => await this.purchaseSlots(),
      reset_btc_rpc: async () => await this.resetBtcRpcUrl(),
      export_private_key: async () => {
        console.log(`Private Key: ${this.exsatAccountInfo.privateKey}`);
        await input({ message: 'Press [enter] to continue' });
      },
      remove_account: async () => await this.removeKeystore(),
      change_email: async () => {
        console.log();
        await changeEmail(accountName, this.exsatAccountInfo.email);
        console.log();
        await input({ message: 'Press [enter] to continue' });
      },
      quit: async () => process.exit(),
    };

    let action;
    do {
      action = await select({
        message: 'Select An Action',
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
    const numberSlots = await inputWithCancel('Enter number of slots(Input "q" to return)', (value) => {
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
    await this.exsatApi.executeAction('poolreg.xsat', 'setdonate', data);
    await this.updateSynchronizerInfo();
    logger.info(
      `${Font.fgCyan}${Font.bright}Set Donation Ratio: ${ratio}% successfully. ${Number(ratio) ? 'Thanks for your support.' : ''}${Font.reset}\n`
    );
    return true;
  }

  /**
   * Resets the reward address for the synchronizer.
   */
  async resetRewardAddress(account: string) {
    const data = {
      synchronizer: this.exsatAccountInfo.accountName,
      financial_account: account,
    };
    await this.exsatApi.executeAction('poolreg.xsat', 'setfinacct', data);
    await this.updateSynchronizerInfo();
    return true;
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
    await this.exsatApi.executeAction('poolreg.xsat', 'buyslot', data);
    await this.updateSynchronizerInfo();
    return true;
  }

  /**
   * Sets the BTC RPC URL, username, and password.
   */
  async setBtcRpcUrl() {
    const btcRpcUrl = await inputWithCancel('Please enter new BTC_RPC_URL(Input "q" to return): ', (input) => {
      if (!isValidUrl(input)) {
        return 'Please enter a valid URL';
      }
      return true;
    });
    if (!btcRpcUrl) {
      return false;
    }
    const values: { [key: string]: string } = {
      BTC_RPC_URL: btcRpcUrl,
      BTC_RPC_USERNAME: '',
      BTC_RPC_PASSWORD: '',
    };

    if (
      await confirm({
        message: 'Do You need to configure the username and password?',
      })
    ) {
      const rpcUsername = await inputWithCancel('Please enter RPC username(Input "q" to return): ');
      if (!rpcUsername) {
        return false;
      }
      const rpcPassword = await inputWithCancel('Please enter RPC password(Input "q" to return): ');
      if (!rpcPassword) {
        return false;
      }
      values['BTC_RPC_USERNAME'] = rpcUsername;
      values['BTC_RPC_PASSWORD'] = rpcPassword;
    }

    updateEnvFile(values);
    process.env.BTC_RPC_URL = btcRpcUrl;
    process.env.BTC_RPC_USERNAME = values['BTC_RPC_USERNAME'];
    process.env.BTC_RPC_PASSWORD = values['BTC_RPC_PASSWORD'];

    logger.info('.env file has been updated successfully.');
    return true;
  }

  /**
   * Resets the BTC RPC URL after confirmation.
   */
  async resetBtcRpcUrl() {
    const rpcUrl = process.env.BTC_RPC_URL;
    if (rpcUrl) {
      if (
        !(await confirm({
          message: `Your BTC_RPC_URL: ${rpcUrl}\nAre you sure to change it?`,
        }))
      ) {
        return;
      }
    }
    return await this.setBtcRpcUrl();
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
    const btcBalance = await this.tableApi.getAccountBalance(this.exsatAccountInfo.accountName);
    if (synchronizerInfo) {
      this.synchronizerInfo = synchronizerInfo;
      return true;
    } else {
      showInfo({
        'Account Name': this.exsatAccountInfo.accountName,
        'Public Key': this.exsatAccountInfo.publicKey,
        'BTC Balance Used for Gas Fee': btcBalance,
        'Account Registration Status': 'Registered',
        'Synchronizer Registration Status': 'Registering',
        Email: this.exsatAccountInfo.email,
      });
      console.log(
        `${Font.fgCyan}${Font.bright}The account has been registered, and a confirmation email has been sent to your inbox.\n` +
          'Please follow the instructions in the email to complete the Synchronizer registration. \n' +
          'If you have already followed the instructions, please wait patiently for the next confirmation email.\n' +
          `-----------------------------------------------${Font.reset}`
      );
      process.exit(0);
    }
  }

  /**
   * Checks the registration status of the account.
   */
  async checkAccountRegistrationStatus() {
    let checkAccountInfo;
    do {
      checkAccountInfo = await checkUsernameWithBackend(this.exsatAccountInfo.accountName);
      let menus;
      switch (checkAccountInfo.status) {
        case 'completed':
          this.exsatAccountInfo = {
            ...this.exsatAccountInfo,
            ...checkAccountInfo,
          };
          break;
        case 'failed':
        case 'initial':
          const statusLabel =
            checkAccountInfo.status === 'failed'
              ? Font.colorize('Registration Failed', Font.fgRed)
              : 'Unregistered, Bridge Gas Fee (BTC) to Register';
          showInfo({
            'Account Name': this.exsatAccountInfo.accountName,
            'Public Key': this.exsatAccountInfo.publicKey,
            'Account Registration Status': statusLabel,
            Email: checkAccountInfo.email,
          });
          if (checkAccountInfo.status === 'failed') {
            console.log(
              'Your account registration was Failed. \n' +
                'Possible reasons: the BTC Transaction ID you provided is incorrect, or the BTC transaction has been rolled back. \n' +
                'Please resubmit the BTC Transaction ID. Thank you.\n' +
                `${Font.fgCyan}${Font.bright}-----------------------------------------------${Font.reset}`
            );
          }
          menus = [
            {
              name: 'Bridge BTC Used For GAS Fee',
              value: 'recharge_btc_registry',
              description: 'Bridge BTC as GAS Fee',
            },
            new Separator(),
            { name: 'Quit', value: 'quit', description: 'Quit' },
          ];
          const action = await select({
            message: 'Select Action',
            choices: menus,
          });
          if (action === 'quit') {
            process.exit(0);
          }
          if (action === 'recharge_btc_registry') {
            await chargeForRegistry(
              this.exsatAccountInfo.accountName,
              checkAccountInfo.btcAddress,
              checkAccountInfo.amount
            );
          }
          break;
        case 'charging':
          showInfo({
            'Account Name': this.exsatAccountInfo.accountName,
            'Public Key': this.exsatAccountInfo.publicKey,
            'Account Registration Status': 'Registering',
            Email: checkAccountInfo.email,
          });
          console.log(
            `${Font.fgCyan}${Font.bright}Account registration may take a moment, please wait.\nConfirmation email will be sent to your inbox after the account registration is complete.\nPlease follow the instructions in the email to complete the subsequent Synchronizer registration.\n-----------------------------------------------${Font.reset}`
          );
          process.exit(0);
          return;
        default:
          throw new Error(`Invalid account: status_${checkAccountInfo.status}`);
      }
    } while (checkAccountInfo.status !== 'completed');
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
        'BTC Balance Used for Gas Fee': btcBalance,
        'Reward Address': 'Unset',
        'Account Registration Status': 'Registered',
        'Synchronizer Registration Status': 'Registered',
        Email: this.exsatAccountInfo.email,
        'Memory Slot': synchronizer.num_slots,
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
        action = await select({ message: 'Select Action: ', choices: menus });
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
        'BTC Balance Used for Gas Fee': btcBalance,
        'Reward Address': synchronizer.memo ?? synchronizer.reward_recipient,
        'BTC PRC Node': 'Unset',
        'Account Registration Status': 'Registered',
        'Synchronizer Registration Status': 'Registered',
        Email: this.exsatAccountInfo.email,
        'Memory Slot': synchronizer.num_slots,
      };
      showInfo(showMessageInfo);

      const menus = [
        { name: 'Set BTC RPC Node', value: 'set_btc_node' },
        new Separator(),
        { name: 'Quit', value: 'quit', description: 'Quit' },
      ];

      const actions: { [key: string]: () => Promise<any> } = {
        set_btc_node: async () => await this.setBtcRpcUrl(),
        quit: async () => process.exit(0),
      };
      let action;
      let res;
      do {
        action = await select({ message: 'Select Action: ', choices: menus });
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
}
