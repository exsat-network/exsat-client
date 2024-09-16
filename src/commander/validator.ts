import TableApi from '../utils/table-api';
import ExsatApi from '../utils/exsat-api';
import { Version } from '../utils/version';
import { notAccountMenu, updateMenu } from './common';
import fs from 'node:fs';
import process from 'node:process';
import { getAccountInfo, getConfigPassword, getInputPassword } from '../utils/keystore';
import { isValidUrl, reloadEnv, retry, showInfo } from '../utils/common';
import { confirm, input, password, select, Separator } from '@inquirer/prompts';
import { chargeBtcForResource, chargeForRegistry, checkUsernameWithBackend } from '@exsat/account-initializer';
import { EXSAT_RPC_URLS } from '../utils/config';
import { logger } from '../utils/logger';
import { inputWithCancel } from '../utils/input';
import { updateEnvFile } from '@exsat/account-initializer/dist/utils';
import { ClientType, ContractName } from '../utils/enumeration';
import { Font } from '../utils/font';

export class ValidatorCommander {
  private exsatAccountInfo: any;
  private validatorInfo: any;
  private tableApi: TableApi;
  private exsatApi: ExsatApi;

  /**
   * Main entry point for the ValidatorCommander.
   * Checks the keystore, initializes APIs, and manages the validator menu.
   */
  async main() {
    // Check if keystore exists
    while (!fs.existsSync(process.env.VALIDATOR_KEYSTORE_FILE)) {
      await notAccountMenu('Validator');
      reloadEnv();
    }

    // Initialize APIs and check account and validator status
    await this.init();
    await this.checkAccountRegistrationStatus();
    await this.checkValidatorRegistrationStatus();
    await this.checkRewardsAddress();
    await this.checkCommission();
    await this.checkBtcRpcNode();

    // Display the main manager menu
    await this.managerMenu();
  }

  /**
   * Displays the main manager menu with various options for the validator.
   */
  async managerMenu() {
    const accountName = this.exsatAccountInfo.accountName;
    const btcBalance = await this.tableApi.getAccountBalance(accountName);
    const validator = this.validatorInfo;

    const showMessageInfo = {
      'Account Name': accountName,
      'Public Key': this.exsatAccountInfo.publicKey,
      'BTC Balance Used for Gas Fee': btcBalance,
      'Reward Address': validator.memo ?? validator.reward_recipient,
      'Commission Rate': `${validator.commission_rate / 100}%` ?? '0%',
      'BTC PRC Node': process.env.BTC_RPC_URL ?? '',
      'BTC Staked': validator.quantity,
      'Eligible for Verification': parseFloat(validator.quantity) > 100 ? 'Yes' : 'No, requires min 100 BTC staked',
      'Account Registration Status': 'Registered',
      'Validator Registration Status': 'Registered',
      Email: this.exsatAccountInfo.email,
    };
    showInfo(showMessageInfo);

    const menus = [
      {
        name: 'Bridge BTC as GAS Fee',
        value: 'recharge_btc',
        description: 'Bridge BTC as GAS Fee',
      },
      {
        name: 'Reset Reward Address',
        value: 'set_reward_address',
        description: 'Set/Reset Reward Address',
        disabled: !validator,
      },
      {
        name: 'Reset Commission Rate',
        value: 'set_commission_rate',
        description: 'Set/Reset Reward Address',
        disabled: !validator,
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
      { name: 'Quit', value: 'quit', description: 'Quit' },
    ];

    const actions: { [key: string]: () => Promise<any> } = {
      recharge_btc: async () => await chargeBtcForResource(process.env.VALIDATOR_KEYSTORE_FILE),
      set_reward_address: async () => await this.setRewardAddress(),
      set_commission_rate: async () => await this.setCommissionRate(),
      reset_btc_rpc: async () => await this.resetBtcRpcUrl(),
      export_private_key: async () => {
        console.log(`Private Key:${this.exsatAccountInfo.privateKey}`);
        await input({ message: 'Press [enter] to continue' });
      },
      remove_account: async () => await this.removeKeystore(),
      quit: async () => process.exit(),
    };

    let action;
    do {
      action = await select({
        message: 'Select An Action',
        choices: menus,
        loop: false,
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
            'Enter your password to Remove Account\n(5 incorrect passwords will exit the program,Enter "q" to return):',
          mask: '*',
        });
        if (passwordInput === 'q') {
          return false;
        }
        await getAccountInfo(process.env.VALIDATOR_KEYSTORE_FILE, passwordInput);
        fs.unlinkSync(process.env.VALIDATOR_KEYSTORE_FILE);
        logger.info('Remove Account successfully');
        process.exit();
      }, 5);
    } catch (e) {
      logger.error('Invalid Password');
      process.exit();
    }
  }

  /**
   * Sets the reward address for the validator.
   */
  async setRewardAddress() {
    const financialAccount = await inputWithCancel('Enter Reward Address(Input "q" to return):', (input: string) => {
      if (!/^0x[a-fA-F0-9]{40}$/.test(input)) {
        return 'Please enter a valid account name.';
      }
      return true;
    });
    if (!financialAccount) {
      return false;
    }
    const data = {
      validator: this.exsatAccountInfo.accountName,
      financial_account: financialAccount,
      commission_rate: null,
    };
    await this.exsatApi.executeAction(ContractName.endrmng, 'config', data);
    logger.info(`Set Reward Account:${financialAccount} successfully`);
    this.validatorInfo = await this.tableApi.getValidatorInfo(this.exsatAccountInfo.accountName);
    return true;
  }

  /**
   * Sets the commission rate for the validator.
   */
  async setCommissionRate() {
    const commissionRate = await inputWithCancel(
      'Enter commission rate (0-10000, Input "q" to return):',
      (input: string) => {
        const number = Number(input);
        if (!Number.isInteger(number) || number < 0 || number > 10000) {
          return 'Please enter a valid integer between 0 and 10000.';
        }
        return true;
      }
    );
    if (!commissionRate) {
      return false;
    }
    const data = {
      validator: this.exsatAccountInfo.accountName,
      financial_account: null,
      commission_rate: commissionRate,
    };
    await this.exsatApi.executeAction(ContractName.endrmng, 'config', data);
    logger.info(`Set Commission Rate:${commissionRate} successfully`);
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
          message: `Your BTC_RPC_URL:${rpcUrl}\nAre you sure to reset it?`,
        }))
      ) {
        return;
      }
    }
    await this.setBtcRpcUrl();
  }

  /**
   * Decrypts the keystore and initializes exsatApi and tableApi.
   */
  async init() {
    this.exsatAccountInfo = await this.decryptKeystore();
    this.exsatApi = new ExsatApi(this.exsatAccountInfo, EXSAT_RPC_URLS);
    await this.exsatApi.initialize();
    this.tableApi = new TableApi(this.exsatApi);
  }

  /**
   * Decrypts the keystore file to retrieve account information.
   */
  async decryptKeystore() {
    let password = getConfigPassword(ClientType.Validator);
    let accountInfo;
    if (password) {
      password = password.trim();
      accountInfo = await getAccountInfo(process.env.VALIDATOR_KEYSTORE_FILE, password);
    } else {
      while (!accountInfo) {
        try {
          password = await getInputPassword();
          if (password === 'q') {
            process.exit(0);
          }
          accountInfo = await getAccountInfo(process.env.VALIDATOR_KEYSTORE_FILE, password);
        } catch (e) {
          logger.warn(e);
        }
      }
    }
    return accountInfo;
  }

  /**
   * Checks the registration status of the validator.
   */
  async checkValidatorRegistrationStatus() {
    const validatorInfo = await this.tableApi.getValidatorInfo(this.exsatAccountInfo.accountName);
    const btcBalance = await this.tableApi.getAccountBalance(this.exsatAccountInfo.accountName);

    if (validatorInfo) {
      this.validatorInfo = validatorInfo;
      return true;
    } else {
      showInfo({
        'Account Name': this.exsatAccountInfo.accountName,
        'Public Key': this.exsatAccountInfo.publicKey,
        'BTC Balance Used for Gas Fee': btcBalance,
        'Account Registration Status': 'Registered',
        'Validator Registration Status': 'Registering',
        Email: this.exsatAccountInfo.email,
      });
      console.log(
        'The account has been registered, and a confirmation email has been sent to your inbox. \n' +
          'Please follow the instructions in the email to complete the Validator registration. \n' +
          'If you have already followed the instructions, please wait patiently for the next confirmation email.'
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
                '-----------------------------------------------'
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
            'Account registration may take a moment, please wait. \nConfirmation email will be sent to your inbox after the account registration is complete.'
          );
          process.exit(0);
          return;
        default:
          throw new Error(`Invalid account: status_${checkAccountInfo.status}`);
      }
    } while (checkAccountInfo.status !== 'completed');
  }

  /**
   * Checks if the reward address is set for the validator.
   */
  async checkRewardsAddress() {
    const accountName = this.exsatAccountInfo.accountName;
    const btcBalance = await this.tableApi.getAccountBalance(accountName);
    const validatorInfo = this.validatorInfo;
    if (!validatorInfo.memo) {
      logger.info('Reward Address is not set.');
      showInfo({
        'Account Name': accountName,
        'Public Key': this.exsatAccountInfo.publicKey,
        'BTC Balance Used for Gas Fee': btcBalance,
        'Reward Address': 'Unset',
        'Account Registration Status': 'Registered',
        'Validator Registration Status': 'Registered',
        Email: this.exsatAccountInfo.email,
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
        action = await select({ message: 'Select Action:', choices: menus });
        res = await (actions[action] || (() => {}))();
      } while (!res);
    } else {
      logger.info('Reward Address is already set correctly.');
    }
  }

  /**
   * Checks if the commission rate is set for the validator.
   */
  async checkCommission() {
    const accountName = this.exsatAccountInfo.accountName;
    const btcBalance = await this.tableApi.getAccountBalance(accountName);
    const validatorInfo = this.validatorInfo;
    if (!validatorInfo.commission_rate) {
      logger.info('Commission Rate is not set.');
      showInfo({
        'Account Name': accountName,
        'Public Key': this.exsatAccountInfo.publicKey,
        'BTC Balance Used for Gas Fee': btcBalance,
        'Reward Address': validatorInfo.memo ?? validatorInfo.reward_recipient,
        'Commission Rate': 'Unset',
        'Account Registration Status': 'Registered',
        'Validator Registration Status': 'Registered',
        Email: this.exsatAccountInfo.email,
      });

      const menus = [
        { name: 'Set Commission Rate', value: 'set_commission_rate' },
        new Separator(),
        { name: 'Quit', value: 'quit', description: 'Quit' },
      ];

      const actions: { [key: string]: () => Promise<any> } = {
        set_commission_rate: async () => await this.setCommissionRate(),
        quit: async () => process.exit(0),
      };
      let action;
      let res;
      do {
        action = await select({ message: 'Select Action:', choices: menus });
        res = await (actions[action] || (() => {}))();
      } while (!res);
    } else {
      logger.info('Commission Rate is already set correctly.');
    }
  }

  /**
   * Checks if the BTC RPC URL is set and valid.
   */
  async checkBtcRpcNode() {
    const rpcUrl = process.env.BTC_RPC_URL;
    const accountName = this.exsatAccountInfo.accountName;
    const btcBalance = await this.tableApi.getAccountBalance(accountName);
    const validatorInfo = this.validatorInfo;
    if (!rpcUrl || !isValidUrl(rpcUrl)) {
      logger.info('BTC_RPC_URL is not set or not in the correct format.');
      const showMessageInfo = {
        'Account Name': accountName,
        'Public Key': this.exsatAccountInfo.publicKey,
        'BTC Balance Used for Gas Fee': btcBalance,
        'Reward Address': validatorInfo.memo ?? validatorInfo.reward_recipient,
        'BTC PRC Node': 'Unset',
        'Account Registration Status': 'Registered',
        'Validator Registration Status': 'Registered',
        Email: this.exsatAccountInfo.email,
      };

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
        action = await select({ message: 'Select Action:', choices: menus });
        res = await (actions[action] || (() => {}))();
      } while (!res);
    } else {
      logger.info('BTC_RPC_URL is already set correctly.');
    }
  }
}
