import { Version } from "../utils/version";
import { isValidUrl, retry, showInfo } from "../utils/common";
import { EXSAT_RPC_URLS } from "../utils/config";
import { input, password, select, Separator, confirm } from "@inquirer/prompts";
import {
  chargeBtcForResource,
  chargeForRegistry,
  checkUsernameWithBackend,
} from "@exsat/account-initializer";
import process from "node:process";
import { getAccountInfo, getConfigPassword, getInputPassword, reloadEnv } from "../utils/keystore";
import { ClientType } from "../utils/enumeration";
import { logger } from "../utils/logger";
import ExsatApi from "../utils/exsat-api";
import TableApi from "../utils/table-api";
import fs from "node:fs";
import { inputWithCancel } from "../utils/input";
import { updateEnvFile } from "@exsat/account-initializer/dist/utils";
import { notAccountMenu, updateMenu } from "./common";

export class SynchronizerCommander {
  private exsatAccountInfo;
  private synchronizerInfo;
  private tableApi: TableApi;
  private exsatApi: ExsatApi;

  async main() {
    // check if keystore exist
    while (!fs.existsSync(process.env.SYNCHRONIZER_KEYSTORE_FILE)) {
      await notAccountMenu('Synchronizer');
      reloadEnv();
    }

    // decrypt keystore
    await this.init();
    //  check account status
    await this.checkAccountRegistrationStatus();

    //  check synchronizer status
    await this.checkSynchronizerRegistrationStatus();

    //
    await this.checkRewardsAddress();

    await this.checkBtcRpcNode();


    // all is ready  manager menu
    await this.managerMenu();

  }

  async managerMenu() {

    const accountName = this.exsatAccountInfo.accountName;
    const btcBalance = await this.tableApi.getAccountBalance(accountName);
    const synchronizer = this.synchronizerInfo;

    const showMessageInfo = {
      'Account Name': accountName,
      'Public Key': this.exsatAccountInfo.publicKey,
      'BTC Balance Used for Gas Fee': btcBalance,
      'Reward Address': synchronizer.memo ?? synchronizer.reward_recipient,
      'BTC PRC Node': process.env.BTC_RPC_URL ?? '',
      'Account Registration Status': 'Registered',
      'Synchronizer Registration Status': 'Registered',
      'Email': this.exsatAccountInfo.email,
      'Memory Slot': synchronizer.num_slots,
    }
    showInfo(showMessageInfo);
    const menus = [
      {
        name: 'Bridge BTC as GAS Fee',
        value: 'recharge_btc',
        description: 'Bridge BTC as GAS Fee',
      },
      {
        name: synchronizer?.reward_recipient
          ? 'Reset Reward Address'
          : 'Set Reward Address',
        value: 'set_reward_address',
        description: 'Set/Reset Reward Address',
        disabled: !synchronizer,
      },
      {
        name: 'Purchase Memory Slot',
        value: 'purchase_memory_slot',
        description: 'Purchase Memory Slot',
        disabled: !synchronizer,
      },
      {
        name: 'Reset BTC RPC Node',
        value: 'reset_btc_rpc',
        description: 'Reset BTC RPC Node',
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
      {
        name: 'Quit',
        value: 'quit',
        description: 'Quit',
      },
    ];

    const actions: { [key: string]: () => Promise<any> } = {
      recharge_btc: async () => await chargeBtcForResource(process.env.SYNCHRONIZER_KEYSTORE_FILE),
      set_reward_address: async () => await this.setRewardAddress(),
      purchase_memory_slot: async () => await this.purchaseSlots(),
      reset_btc_rpc: async () => await this.resetBtcRpcUrl(),
      export_private_key: async () => {
        console.log(
          `Private Key:${this.exsatAccountInfo.privateKey}`,
        );
        await input({ message: 'Press [enter] to continue' });
      },
      remove_account: async () => await this.removeKeystore(),
      quit: async () => {
        process.exit();
      },
    };

    let action;
    do {
      action = await select({
        message: 'Select An Action',
        choices: menus,
        loop: false
      });
      if (action !== '99') {
        await (actions[action] || (() => {
        }))();
      }
    } while (action !== '99');
  }

  async removeKeystore() {
    try {
      await retry(async () => {
        const passwordInput = await password({
          message:
            'Enter your password to Remove Account\n(5 incorrect passwords will exit the program,Enter "q" to return):',
        });
        if (passwordInput === 'q') {
          return false;
        }
        await getAccountInfo(process.env.SYNCHRONIZER_KEYSTORE_FILE, passwordInput);
        fs.unlinkSync(process.env.SYNCHRONIZER_KEYSTORE_FILE);
        logger.info('Remove Account successfully');
        process.exit();
      }, 5);
    } catch (e) {
      logger.error('Invaild Password');
      process.exit();
    }
  }

  /**
   *  buy slots
   */
  async purchaseSlots() {

    const numberSlots = await inputWithCancel(
      'Enter number of slots(Input "q" to return)',
      (value) => {
        const num = Number(value);
        if (!Number.isInteger(num) || num < 1) {
          return 'Please enter a valid number more than 0';
        }
        return true;
      },
    );
    if (!numberSlots) {
      return;
    }

    await this.buySlots(parseInt(numberSlots));
    logger.info(`
        Buy
        slots:${numberSlots} successfully`);
  }

  /**
   *  set finance account
   *
   */
  async setRewardAddress() {
    const financialAccount = await inputWithCancel(
      'Enter Reward Address(Input "q" to return):',
      (input: string) => {
        if (!/^0x[a-fA-F0-9]{40}$/.test(input)) {
          return 'Please enter a valid account name.';
        }
        return true;
      },
    );
    if (!financialAccount) {
      return false;
    }
    await this.resetRewardAddress(financialAccount);
    logger.info(`
        Set
        Reward
        Account:${financialAccount} successfully`);
  }

  async resetRewardAddress(account: string) {
    const data = {
      synchronizer: this.exsatAccountInfo.accountName,
      financial_account: account,
    };
    return await this.exsatApi.executeAction(
      'poolreg.xsat',
      'setfinacct',
      data,
    );
  }

  async buySlots(slots) {
    const data = {
      synchronizer: this.exsatAccountInfo.accountName,
      receiver: this.exsatAccountInfo.accountName,
      num_slots: slots,
    };
    return await this.exsatApi.executeAction(
      'poolreg.xsat',
      'buyslot',
      data,
    );
  }

  /**
   * Set BTC_RPC_URL USERNAME and PASSWORD
   */
  async setBtcRpcUrl() {
    const btcRpcUrl = await inputWithCancel(
      'Please enter new BTC_RPC_URL(Input "q" to return): ',
      (input) => {
        if (!isValidUrl(input)) {
          return 'Please enter a valid URL';
        }
        return true;
      },
    );
    if (!btcRpcUrl) {
      return false;
    }
    const values = {};

    // Update .env file
    values['BTC_RPC_URL'] = btcRpcUrl;
    values['BTC_RPC_USERNAME'] = '';
    values['BTC_RPC_PASSWORD'] = '';
    let rpcUsername: boolean | string = '';
    let rpcPassword: boolean | string = '';
    if (
      await confirm({
        message: 'Do You need to configure the username and password?',
      })
    ) {
      rpcUsername = await inputWithCancel(
        'Please enter RPC username(Input "q" to return): ',
      );
      if (!rpcUsername) {
        return false;
      }
      rpcPassword = await inputWithCancel(
        'Please enter RPC password(Input "q" to return): ',
      );
      if (!rpcPassword) {
        return false;
      }
    }
    values['BTC_RPC_USERNAME'] = rpcUsername;
    values['BTC_RPC_PASSWORD'] = rpcPassword;

    updateEnvFile(values);
    process.env.BTC_RPC_URL = btcRpcUrl;
    process.env.BTC_RPC_USERNAME = rpcUsername;
    process.env.BTC_RPC_PASSWORD = rpcPassword;

    logger.info('.env file has been updated successfully.');
    return true;
  }

  async resetBtcRpcUrl() {
    const rpcUrl = process.env.BTC_RPC_URL;
    if (rpcUrl) {
      if (
        !(await confirm({
          message: `Your BTC_RPC_URL:${rpcUrl}\nAre you sure to reset it?`,
        }))
      ) {
        return;
      }
    }
    return await this.setBtcRpcUrl();
  }


  /**
   * Decrypt keystore and initialize exsatApi and tableApi
   */
  async init() {

    this.exsatAccountInfo = await this.decryptKeystore();

    this.exsatApi = new ExsatApi(this.exsatAccountInfo, EXSAT_RPC_URLS);
    await this.exsatApi.initialize();
    this.tableApi = new TableApi(this.exsatApi);
  }

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
        'Email': this.exsatAccountInfo.email,
      });
      console.log(
        'The account has been registered, and a confirmation email has been sent to your inbox. \n' +
        'Please follow the instructions in the email to complete the Synchronizer registration. \n' +
        'If you have already followed the instructions, please wait patiently for the next confirmation email.');
      process.exit(0);
    }
  }

  async checkAccountRegistrationStatus() {
    let checkAccountInfo;
    do {
      checkAccountInfo = await checkUsernameWithBackend(
        this.exsatAccountInfo.accountName,
      );
      let menus;
      switch (checkAccountInfo.status) {
        case 'completed':
          this.exsatAccountInfo = { ...this.exsatAccountInfo, ...checkAccountInfo }
          break;
        case 'initial':
          showInfo({
            'Account Name': this.exsatAccountInfo.accountName,
            'Public Key': this.exsatAccountInfo.publicKey,
            'Account Registration Status': 'Unregistered, Bridge Gas Fee (BTC) to Register',
            'Email': checkAccountInfo.email,
          });
          menus = [
            {
              name: 'Bridge BTC Used For GAS Fee',
              value: 'recharge_btc_registry',
              description: 'Bridge BTC as GAS Fee',
            },
            new Separator(),
            {
              name: 'Quit',
              value: 'quit',
              description: 'Quit',
            },
          ];
          const action = await select({ message: 'Select Action', choices: menus });
          if (action === 'quit') {
            process.exit(0);
          }
          if (action === 'recharge_btc_registry') {
            await chargeForRegistry(this.exsatAccountInfo.accountName, checkAccountInfo.btcAddress, checkAccountInfo.amount);
          }
          break;
        case 'charging':
          showInfo({
            'Account Name': this.exsatAccountInfo.accountName,
            'Public Key': this.exsatAccountInfo.publicKey,
            'Account Registration Status': 'Registering',
            'Email': checkAccountInfo.email,
          });
          console.log('Account registration may take a moment, please wait. \nConfirmation email will be sent to your inbox after the account registration is complete.');
          process.exit(0);
          return;
        default:
          throw new Error(`Invalid account: status_${checkAccountInfo.status}`);
      }
    } while (checkAccountInfo.status !== 'completed');
  }

  async checkRewardsAddress() {
    const accountName = this.exsatAccountInfo.accountName;
    const btcBalance = await this.tableApi.getAccountBalance(accountName);
    const synchronizer = this.synchronizerInfo;
    if (!synchronizer.memo) {
      logger.info('Reward Address is not set.');
      // Prompt user for new BTC_RPC_URL
      showInfo({
        'Account Name': accountName,
        'Public Key': this.exsatAccountInfo.publicKey,
        'BTC Balance Used for Gas Fee': btcBalance,
        'Reward Address': 'Unset',
        'Account Registration Status': 'Registered',
        'Synchronizer Registration Status': 'Registered',
        'Email': this.exsatAccountInfo.email,
        'Memory Slot': synchronizer.num_slots,
      });

      const menus = [
        {
          name: 'Set Reward Address ( EVM )',
          value: 'set_reward_address',
        },
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
        action = await select({
          message: 'Select Action:',
          choices: menus,
        });
        res = await (actions[action] || (() => {
        }))();

      } while (!res);

    } else {
      logger.info('Reward Address is already set correctly.');
    }
  }

  async checkBtcRpcNode() {
    const rpcUrl = process.env.BTC_RPC_URL;
    const accountName = this.exsatAccountInfo.accountName;
    const btcBalance = await this.tableApi.getAccountBalance(accountName);
    const synchronizer = this.synchronizerInfo;
    if (!rpcUrl || !isValidUrl(rpcUrl)) {
      logger.info('BTC_RPC_URL is not set or not in the correct format.');
      // Prompt user for new BTC_RPC_URL
      const showMessageInfo = {
        'Account Name': accountName,
        'Public Key': this.exsatAccountInfo.publicKey,
        'BTC Balance Used for Gas Fee': btcBalance,
        'Reward Address': synchronizer.memo ?? synchronizer.reward_recipient,
        'BTC PRC Node': 'Unset',
        'Account Registration Status': 'Registered',
        'Synchronizer Registration Status': 'Registered',
        'Email': this.exsatAccountInfo.email,
        'Memory Slot': synchronizer.num_slots,
      }

      const menus = [
        {
          name: 'Set BTC RPC Node',
          value: 'set_btc_node',
        },
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
        action = await select({
          message: 'Select Action:',
          choices: menus,
        });
        res = await (actions[action] || (() => {
        }))();

      } while (!res);

    } else {
      logger.info('BTC_RPC_URL is already set correctly.');
    }
  }


}