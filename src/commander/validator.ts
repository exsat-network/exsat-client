import TableApi from '../utils/table-api';
import ExsatApi from '../utils/exsat-api';
import { checkExsatUrls, exportPrivateKey, notAccountMenu, resetBtcRpcUrl, setBtcRpcUrl } from './common';
import fs from 'node:fs';
import process from 'node:process';
import { getAccountInfo, getConfigPassword, getInputPassword } from '../utils/keystore';
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
import { confirm, input, password, select, Separator } from '@inquirer/prompts';
import { EXSAT_RPC_URLS, NETWORK_CONFIG, SET_VALIDATOR_DONATE_RATIO } from '../utils/config';
import { logger } from '../utils/logger';
import { inputWithCancel } from '../utils/input';
import { Client, ClientType, ContractName } from '../utils/enumeration';
import { Font } from '../utils/font';
import { getUserAccount } from './account';
import { evmAddressToChecksum } from '../utils/key';

export class ValidatorCommander {
  private exsatAccountInfo: any;
  private validatorInfo: any;
  private tableApi: TableApi;
  private exsatApi: ExsatApi;

  constructor(private role) {}

  /**
   * Main entry point for the ValidatorCommander.
   * Checks the keystore, initializes APIs, and manages the validator menu.
   */
  async main() {
    // Check if keystore exists
    while (!fs.existsSync(process.env.VALIDATOR_KEYSTORE_FILE)) {
      await notAccountMenu(this.role);
      reloadEnv();
    }

    // Initialize APIs and check account and validator status
    await this.init();
    await this.checkAccountRegistrationStatus();
    await this.checkValidatorRegistrationStatus();
    await this.checkRewardsAddress();
    // await this.checkCommission();
    // await this.checkDonateSetting();
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

    let showMessageInfo: any = {
      'Account Name': accountName,
      'Account Role': validator.role ? 'XSAT Validator' : 'BTC Validator',
      'Public Key': this.exsatAccountInfo.publicKey,
      'Gas Balance': btcBalance ? btcBalance : `0.00000000 BTC`,
      'Commission Ratio': `${validator.commission_rate / 100}%` ?? '0%',
      'Commission Address': validator.reward_address ? `0x${validator.reward_address}` : '',
      'BTC Staked': validator.quantity,
      'XSAT Staked': validator.xsat_quantity,
      'Eligible for Consensus': validator.role
        ? parseFloat(validator.xsat_quantity) >= 2100
          ? 'Yes'
          : 'No, requires min 2100 XSAT staked'
        : parseFloat(validator.quantity) >= 100
          ? 'Yes'
          : 'No, requires min 100 BTC staked',
      'Stake Address': validator.stake_address ? `0x${validator.stake_address}` : '',
      'BTC RPC Node': process.env.BTC_RPC_URL ?? '',
    };
    if (validator.role) {
      delete showMessageInfo['BTC Staked'];
      delete showMessageInfo['Commission Address'];
      delete showMessageInfo['Commission Ratio'];
    } else {
      delete showMessageInfo['XSAT Staked'];
    }

    showInfo(showMessageInfo);

    let menus = [
      /* {
        name: 'Recharge Gas',
        value: 'recharge_btc',
        description: 'Recharge Gas',
      },*/
      {
        name: 'Change Stake Address',
        value: 'set_stake_address',
        description: 'Set/Change Stake Address',
        disabled: validator.role ? parseFloat(validator.xsat_quantity) != 0 : parseFloat(validator.quantity) != 0,
      },

      /* {
        name: `${validator?.donate_rate ? 'Change' : 'Set'} Donation Ratio`,
        value: 'set_donation_ratio',
        description: 'Set/Change Donation Ratio',
        disabled: !validator,
      },*/
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
    if (!validator.role) {
      menus.splice(
        1,
        0,
        {
          name: 'Change Commission Address',
          value: 'set_reward_address',
          description: 'Set/Change Commission Address',
          disabled: !validator,
        },
        {
          name: 'Change Commission Ratio',
          value: 'set_commission_ratio',
          description: 'Set/Change Reward Address',
          disabled: !validator,
        }
      );
    }
    const actions: { [key: string]: () => Promise<any> } = {
      set_reward_address: async () => await this.setRewardAddress(),
      set_stake_address: async () => await this.setStakeAddress(),
      set_commission_ratio: async () => await this.setCommissionRatio(),
      set_donation_ratio: async () => await this.setDonationRatio(),
      reset_btc_rpc: async () => await resetBtcRpcUrl(),
      export_private_key: async () => {
        return await exportPrivateKey(this.exsatAccountInfo.privateKey);
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
    const rewardAddress = await inputWithCancel('Enter commission address(Input "q" to return): ', (input: string) => {
      if (!/^0x[a-fA-F0-9]{40}$/.test(input)) {
        return 'Please enter a valid account name.';
      }
      return true;
    });
    if (!rewardAddress) {
      return false;
    }
    const data = {
      validator: this.exsatAccountInfo.accountName,
      reward_addr: evmAddressToChecksum(rewardAddress),
    };

    const res: any = await this.exsatApi.executeAction(ContractName.endrmng, 'setrwdaddr', data);
    if (res && res.transaction_id) {
      logger.info(`Set reward commission: ${rewardAddress} successfully`);
      await this.updateValidatorInfo();
      return true;
    } else {
      logger.error(`Validator[${this.exsatAccountInfo.accountName}] Set commission address: ${rewardAddress} failed`);
      return false;
    }
  }
  /**
   * Sets the reward address for the validator.
   */
  async setStakeAddress() {
    const stakeAddress = await inputWithCancel('Enter stake address(Input "q" to return): ', (input: string) => {
      if (!/^0x[a-fA-F0-9]{40}$/.test(input)) {
        return 'Please enter a valid account name.';
      }
      return true;
    });
    if (!stakeAddress) {
      return false;
    }
    const data = {
      validator: this.exsatAccountInfo.accountName,
      stake_addr: evmAddressToChecksum(stakeAddress),
    };

    const res: any = await this.exsatApi.executeAction(ContractName.endrmng, 'evmsetstaker', data);
    if (res && res.transaction_id) {
      logger.info(`Set stake address: ${stakeAddress} successfully`);
      await this.updateValidatorInfo();
      return true;
    } else {
      logger.error(`Validator[${this.exsatAccountInfo.accountName}] Set stake address: ${stakeAddress} failed`);
      return false;
    }
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
    const res: any = await this.exsatApi.executeAction(ContractName.endrmng, 'config', data);
    if (res && res.transaction_id) {
      await this.updateValidatorInfo();
      logger.info(`${Font.fgCyan}${Font.bright}Set commission ratio: ${commissionRatio}% successfully.${Font.reset}\n`);
      return true;
    } else {
      logger.error(`Validator[${this.exsatAccountInfo.accountName}] Set commission ratio: ${commissionRatio} failed`);
      return false;
    }
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
    const res: any = await this.exsatApi.executeAction(ContractName.endrmng, 'setdonate', data);
    if (res && res.transaction_id) {
      logger.info(
        `${Font.fgCyan}${Font.bright}Set donation ratio: ${ratio}% successfully. ${Number(ratio) ? 'Thanks for your support.' : ''}${Font.reset}\n`
      );
      await this.updateValidatorInfo();
      return true;
    } else {
      logger.error(`Validator[${this.exsatAccountInfo.accountName}] Set donation ratio: ${ratio} failed`);
      return false;
    }
  }

  /**
   * To activate and become a official validator.
   * @returns {Promise<boolean>}
   */
  async toActivateValidator() {
    const activateValidatorQuotas: any = await this.tableApi.getActivateValidatorQuotas();
    if (!activateValidatorQuotas || activateValidatorQuotas.total_quotas == 0) {
      console.log(Font.importMessageCyan("The competition hasn't started yet. Please wait."));
      await input({ message: 'Press [Enter] to continue...' });
      return false;
    }
    if (activateValidatorQuotas.total_quotas <= activateValidatorQuotas.total_activations) {
      console.log(Font.importMessageCyan('The number of quotas has been used up. Please wait for the next round.'));
      await input({ message: 'Press [Enter] to continue...' });
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
        const res: any = await this.activeValidator();
        if (res && res.transaction_id) {
          console.log(Font.importMessageCyan('Congratulations on securing a quota and becoming a validator.'));
          await input({ message: 'Press [Enter] to continue...' });
          return true;
        } else {
          logger.error(`${this.exsatAccountInfo.accountName} Failed to activate validator.`);
          process.exit(0);
        }
      } catch (e) {
        const errorMessage = getErrorMessage(e);
        // network error or timeout
        if (errorMessage.includes('Round has not started yet')) {
          const menu = [
            {
              name: 'Retry Activation',
              value: 'retry',
            },
            {
              name: 'Quit',
              value: 'quit',
            },
          ];
          const action = await select({ choices: menu, message: 'Please select an action: ' });
          if (action === 'quit') {
            return false;
          }
        } else {
          logger.error(errorMessage.replace('compete.xsat::activate: ', ''));
          return false;
        }
      }
    } while (true);
  }

  async activeValidator() {
    console.log(Font.importMessageCyan('Competing for a quota...'));
    return await this.exsatApi.executeAction(
      ContractName.compete,
      'activate',
      {
        validator: this.exsatAccountInfo.accountName,
      },
      false
    );
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

    if (!validatorInfo) {
      const confirmInput = await confirm({
        message:
          'You have already created your account, please continue to setup your profile to complete the registration.',
      });
      if (!confirmInput) {
        process.exit(0);
      } else {
        await this.registerValidator();
      }
      this.validatorInfo = await this.tableApi.getValidatorInfo(this.exsatAccountInfo.accountName);
    } else {
      this.validatorInfo = validatorInfo;
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
        'Account Role': this.exsatAccountInfo.role == Client.BTCValidator ? 'BTC Validator' : 'XSAT Validator',
        'Public Key': this.exsatAccountInfo.publicKey,
        'Registration Url': `${NETWORK_CONFIG.register}/${btoa(`account=${this.exsatAccountInfo.accountName}&pubkey=${this.exsatAccountInfo.publicKey}&role=${this.exsatAccountInfo.role}`)}`,
      });
      console.log(
        `Please note that your registration has not finished yet!\n${Font.fgGreen}${Font.bright}Please copy the Registration Url above and past to your browser to finish the registration.${Font.reset}`
      );
      process.exit(0);
    }
    return true;
  }

  /**
   * Checks if the reward address is set for the validator.
   */
  async checkRewardsAddress() {
    const accountName = this.exsatAccountInfo.accountName;
    const btcBalance = await this.tableApi.getAccountBalance(accountName);
    const validatorInfo = this.validatorInfo;
    if (!validatorInfo.reward_address) {
      logger.info('Commission address is not set.');
      showInfo({
        'Account Name': accountName,
        'Public Key': this.exsatAccountInfo.publicKey,
        'BTC Balance Used for Gas Fee': btcBalance,
        'Commission Address': 'Unset',
        'Account Registration Status': 'Registered',
        'Validator Registration Status': 'Registered',
      });

      const menus = [
        { name: 'Set Commission Address(EVM)', value: 'set_reward_address' },
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
      logger.info('Commission address is already set correctly.');
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
        'Commission Address': validatorInfo.reward_address ? `0x${validatorInfo.reward_address}` : '',
        'Commission Ratio': 'Unset',
        'Account Registration Status': 'Registered',
        'Validator Registration Status': 'Registered',
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
        'Commission Address': validatorInfo.reward_address ? `0x${validatorInfo.reward_address}` : '',
        'BTC PRC Node': 'Unset',
        'Account Registration Status': 'Registered',
        'Validator Registration Status': 'Registered',
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

  async registerValidator() {
    const role = this.exsatAccountInfo.role;
    const stakeAddress = await input({
      message: 'Enter your stake address: ',
      validate: (value) => {
        return isValidEvmAddress(value) ? true : 'Invalid address';
      },
    });
    let claimableAddress;
    let commissionRate;
    if (role === Client.BTCValidator) {
      claimableAddress = await input({
        message: 'Enter your commission address: ',
        validate: (value) => {
          return isValidEvmAddress(value) ? true : 'Invalid address';
        },
      });
      commissionRate = await input({
        message: 'Enter your commission ratio (0-100): ',
        validate: (value) => {
          //Determine whether it is a number between 0.00-100.00
          const num = parseFloat(value);
          // Check if it is a valid number and within the range
          if (!isNaN(num) && num >= 0 && num <= 100 && /^\d+(\.\d{1,2})?$/.test(value)) {
            return true;
          }
          return 'Please enter a valid number between 0.00 and 100.00';
        },
      });
    }
    const data = {
      validator: this.exsatAccountInfo.accountName,
      role: role == Client.BTCValidator ? 0 : 1,
      stake_addr: evmAddressToChecksum(stakeAddress),
      reward_addr: claimableAddress ? evmAddressToChecksum(claimableAddress) : null,
      commission_rate: commissionRate ? parseFloat(commissionRate) * 100 : null,
    };

    const res: any = await this.exsatApi.executeAction(ContractName.endrmng, 'newregvldtor', data);
    await sleep(1000);

    return res;
  }
}
