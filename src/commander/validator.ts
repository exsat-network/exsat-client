import TableApi from '../utils/table-api';
import ExsatApi from '../utils/exsat-api';
import { checkExsatUrls, notAccountMenu, resetBtcRpcUrl, setBtcRpcUrl } from './common';
import fs from 'node:fs';
import process from 'node:process';
import { getAccountInfo, getConfigPassword, getInputPassword } from '../utils/keystore';
import { getErrorMessage, isValidUrl, reloadEnv, retry, showInfo, sleep } from '../utils/common';
import { confirm, input, password, select, Separator } from '@inquirer/prompts';
import { chargeBtcForResource, chargeForRegistry, checkUsernameWithBackend } from '@exsat/account-initializer';
import { EXSAT_RPC_URLS, SET_VALIDATOR_DONATE_RATIO } from '../utils/config';
import { logger } from '../utils/logger';
import { inputWithCancel } from '../utils/input';
import { updateEnvFile } from '@exsat/account-initializer/dist/utils';
import { Client, ClientType, ContractName } from '../utils/enumeration';
import { Font } from '../utils/font';
import { changeEmail } from '@exsat/account-initializer/dist/accountInitializer';

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
      await notAccountMenu(Client.Validator);
      reloadEnv();
    }

    // Initialize APIs and check account and validator status
    await this.init();
    await this.checkAccountRegistrationStatus();
    await this.checkValidatorRegistrationStatus();
    await this.checkRewardsAddress();
    await this.checkCommission();
    await this.checkDonateSetting();
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
    const activedInfo = await this.getValidatedInfo();

    let showMessageInfo: any = {
      'Account Name': accountName,
      'Public Key': this.exsatAccountInfo.publicKey,
      'BTC Balance Used for Gas Fee': btcBalance,
      'Reward Address': validator.memo ?? validator.reward_recipient,
      'Commission Ratio': `${validator.commission_rate / 100}%` ?? '0%',
      'Donation Ratio': `${validator.donate_rate / 100}%` ?? '0%',
      'BTC PRC Node': process.env.BTC_RPC_URL ?? '',
      'BTC Staked': validator.quantity,
      'Eligible for Verification': parseFloat(validator.quantity) > 100 ? 'Yes' : 'No, requires min 100 BTC staked',
      'Account Registration Status': 'Registered',
      'Validator Registration Status': 'Registered',
      Email: this.exsatAccountInfo.email,
    };
    showInfo(showMessageInfo);

    let menus = [
      {
        name: 'Bridge BTC as GAS Fee',
        value: 'recharge_btc',
        description: 'Bridge BTC as GAS Fee',
      },
      {
        name: 'Change Reward Address',
        value: 'set_reward_address',
        description: 'Set/Change Reward Address',
        disabled: !validator,
      },
      {
        name: 'Change Commission Ratio',
        value: 'set_commission_ratio',
        description: 'Set/Change Reward Address',
        disabled: !validator,
      },
      {
        name: `${validator?.donate_rate ? 'Change' : 'Set'} Donation Ratio`,
        value: 'set_donation_ratio',
        description: 'Set/Change Donation Ratio',
        disabled: !validator,
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

    if (!activedInfo) {
      menus.unshift({
        name: 'Compete to win a Validator quota',
        value: 'activate_validator',
        description: 'To activate validator',
      });
    }

    const actions: { [key: string]: () => Promise<any> } = {
      recharge_btc: async () => await chargeBtcForResource(process.env.VALIDATOR_KEYSTORE_FILE),
      set_reward_address: async () => await this.setRewardAddress(),
      set_commission_ratio: async () => await this.setCommissionRatio(),
      set_donation_ratio: async () => await this.setDonationRatio(),
      reset_btc_rpc: async () => await resetBtcRpcUrl(),
      export_private_key: async () => {
        console.log(`Private Key: ${this.exsatAccountInfo.privateKey}`);
        await input({ message: 'Press [enter] to continue' });
      },
      change_email: async () => {
        console.log();
        await changeEmail(accountName, this.exsatAccountInfo.email);
        console.log();
        await input({ message: 'Press [enter] to continue' });
      },
      activate_validator: async () => {
        const res = await this.toActivateValidator();
        if (res) {
          menus.shift();
        }
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
        await getAccountInfo(process.env.VALIDATOR_KEYSTORE_FILE, passwordInput);
        fs.unlinkSync(process.env.VALIDATOR_KEYSTORE_FILE);
        logger.info('Remove account successfully');
        process.exit();
      }, 5);
    } catch (e) {
      logger.error('Invalid password');
      process.exit();
    }
  }

  /**
   * Sets the reward address for the validator.
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
    const data = {
      validator: this.exsatAccountInfo.accountName,
      financial_account: financialAccount,
      commission_rate: null,
    };
    await this.exsatApi.executeAction(ContractName.endrmng, 'config', data);
    logger.info(`Set reward address: ${financialAccount} successfully`);
    await this.updateValidatorInfo();
    return true;
  }

  /**
   * Sets the commission ratio for the validator.
   */
  async setCommissionRatio() {
    const commissionRatio = await inputWithCancel(
      'Enter commission ratio (0.00-100.00, Input "q" to return): ',
      (value: string) => {
        //Determine whether it is a number between 0.00-100.00
        const num = parseFloat(value);
        // Check if it is a valid number and within the range
        if (!isNaN(num) && num >= 0 && num <= 100 && /^\d+(\.\d{1,2})?$/.test(value)) {
          return true;
        }
        return 'Please enter a valid number between 0.00 and 100.00';
      }
    );
    if (!commissionRatio) {
      return false;
    }
    const data = {
      validator: this.exsatAccountInfo.accountName,
      financial_account: null,
      commission_rate: parseFloat(commissionRatio) * 100,
    };
    await this.exsatApi.executeAction(ContractName.endrmng, 'config', data);
    await this.updateValidatorInfo();
    logger.info(`${Font.fgCyan}${Font.bright}Set commission ratio: ${commissionRatio}% successfully.${Font.reset}\n`);
    return true;
  }

  /**
   * Sets the donation ratio for the validator.
   */
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
      validator: this.exsatAccountInfo.accountName,
      donate_rate: parseFloat(ratio) * 100,
    };
    await this.exsatApi.executeAction(ContractName.endrmng, 'setdonate', data);
    logger.info(
      `${Font.fgCyan}${Font.bright}Set donation ratio: ${ratio}% successfully. ${Number(ratio) ? 'Thanks for your support.' : ''}${Font.reset}\n`
    );
    await this.updateValidatorInfo();
    return true;
  }

  /**
   * To activate and become a official validator.
   * @returns {Promise<boolean>}
   */
  async toActivateValidator() {
    const activateValidatorQuotas: any = await this.tableApi.getActivateValidatorQuotas();
    if (!activateValidatorQuotas || activateValidatorQuotas.total_quotas == 0) {
      console.log(Font.importMessageCyan("The competition hasn't started yet. Please wait."));
      await input({ message: 'Press [enter] to continue' });
      return false;
    }
    if (activateValidatorQuotas.total_quotas <= activateValidatorQuotas.total_activations) {
      console.log(Font.importMessageCyan('The number of quotas has been used up. Please wait for the next round.'));
      await input({ message: 'Press [enter] to continue' });
      return false;
    }
    if (
      !(await confirm({
        message: Font.importMessageCyan('Please confirm to start participating in the competition.'),
      }))
    ) {
      return false;
    }
    do {
      try {
        const res = await this.activeValidator();
        console.log(Font.importMessageCyan('Congratulations on securing a quota and becoming a validator.'));
        await input({ message: 'Press [enter] to continue' });
        return true;
      } catch (e) {
        const errorMessage = getErrorMessage(e);
        // network error or timeout
        if (errorMessage.includes('round has not started yet')) {
          const menu = [
            {
              name: 'retry active',
              value: 'retry',
            },
            {
              name: 'quit',
              value: 'quit',
            },
          ];
          const action = await select({ choices: menu, message: 'Please select an action: ' });
          if (action === 'quit') {
            return false;
          }
        } else {
          logger.error(errorMessage);
          return false;
        }
      }
    } while (true);
  }

  async activeValidator() {
    console.log(Font.importMessageCyan('Competing for a quota...'));
    return await this.exsatApi.executeAction(ContractName.compete, 'activate', {
      validator: this.exsatAccountInfo.accountName,
    });
  }

  async getValidatedInfo(): Promise<any> {
    return await this.tableApi.getValidatorActivatedInfo(this.exsatAccountInfo.accountName);
  }

  async checkActovateValidatorQuotas() {
    const activateValidatorQuotas: any = await this.tableApi.getActivateValidatorQuotas();
    if (activateValidatorQuotas.total_quotas <= activateValidatorQuotas.total_activations) {
      return false;
    }
    return true;
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
              'Your account registration was failed. \n' +
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
            message: 'Select an Action',
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
            `${Font.fgCyan}${Font.bright}Account registration may take a moment, please wait.\nConfirmation email will be sent to your inbox after the account registration is complete.\nPlease follow the instructions in the email to complete the subsequent Validator registration.\n-----------------------------------------------${Font.reset}`
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
      logger.info('Reward address is not set.');
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
        action = await select({ message: 'Select an Action: ', choices: menus });
        res = await (actions[action] || (() => {}))();
      } while (!res);
    } else {
      logger.info('Reward address is already set correctly.');
    }
  }

  /**
   * Checks if the commission ratio is set for the validator.
   */
  async checkCommission() {
    const accountName = this.exsatAccountInfo.accountName;
    const btcBalance = await this.tableApi.getAccountBalance(accountName);
    const validatorInfo = this.validatorInfo;
    if (!validatorInfo.commission_rate) {
      logger.info('Commission ratio is not set.');
      showInfo({
        'Account Name': accountName,
        'Public Key': this.exsatAccountInfo.publicKey,
        'BTC Balance Used for Gas Fee': btcBalance,
        'Reward Address': validatorInfo.memo ?? validatorInfo.reward_recipient,
        'Commission Ratio': 'Unset',
        'Account Registration Status': 'Registered',
        'Validator Registration Status': 'Registered',
        Email: this.exsatAccountInfo.email,
      });

      const menus = [
        { name: 'Set Commission Ratio', value: 'set_commission_ratio' },
        new Separator(),
        { name: 'Quit', value: 'quit', description: 'Quit' },
      ];

      const actions: { [key: string]: () => Promise<any> } = {
        set_commission_ratio: async () => await this.setCommissionRatio(),
        quit: async () => process.exit(0),
      };
      let action;
      let res;
      do {
        action = await select({ message: 'Select an Action: ', choices: menus });
        res = await (actions[action] || (() => {}))();
      } while (!res);
    } else {
      logger.info('Commission ratio is already set correctly.');
    }
  }

  /**
   * Checks if the donate setting is set for the synchronizer.
   */
  async checkDonateSetting() {
    if (!this.validatorInfo.donate_rate && !SET_VALIDATOR_DONATE_RATIO) {
      console.log(
        `\n${Font.fgCyan}${Font.bright}You haven't set the donation ratio yet. Please set it first.${Font.reset}`
      );
      await this.setDonationRatio();
      updateEnvFile({ SET_VALIDATOR_DONATE_RATIO: true });
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
    const validatorInfo = this.validatorInfo;
    if (!rpcUrl || !isValidUrl(rpcUrl)) {
      logger.info('BTC_RPC_URL is not set or is in an incorrect format');
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

  /**
   * Update the validator info.
   */
  async updateValidatorInfo() {
    await sleep(1000);
    this.validatorInfo = await this.tableApi.getValidatorInfo(this.exsatAccountInfo.accountName);
  }
}
