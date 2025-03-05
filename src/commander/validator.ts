import TableApi from '../utils/table-api';
import ExsatApi from '../utils/exsat-api';
import {
  checkAccountRegistrationStatus,
  checkExsatUrls,
  exportPrivateKey,
  notAccountMenu,
  removeKeystore,
  resetBtcRpcUrl,
  setBtcRpcUrl,
} from './common';
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
import { EXSAT_RPC_URLS, NETWORK, NETWORK_CONFIG, SET_VALIDATOR_DONATE_RATIO } from '../utils/config';
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
  private keystoreFile: string;
  private blkendtConfig: any;
  private registration: boolean;

  constructor(exsatAccountInfo, registration = false) {
    this.exsatAccountInfo = exsatAccountInfo;
    this.registration = registration;
  }

  /**
   * Main entry point for the ValidatorCommander.
   * Checks the keystore, initializes APIs, and manages the validator menu.
   */
  async main() {
    // Initialize APIs and check account and validator status
    await this.init();
    await checkAccountRegistrationStatus(this.exsatAccountInfo);
    await this.checkValidatorRegistrationStatus();

    await this.checkRewardsAddress();
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
    let showMessageInfo;
    if (validator.role) {
      showMessageInfo = {
        'Account Name': accountName,
        'Account Role': 'XSAT Validator',
        'Public Key': this.exsatAccountInfo.publicKey,
        'Gas Balance': btcBalance ? btcBalance : `0.00000000 BTC`,
        'Total XSAT Staked': validator.xsat_quantity,
        'Is eligible for consensus':
          parseFloat(validator.xsat_quantity) >= parseFloat(this.blkendtConfig.min_xsat_qualification)
            ? 'Yes'
            : `No, requires staking ${this.blkendtConfig.min_xsat_qualification}`,
        'Stake Address': validator.stake_address ? `0x${validator.stake_address}` : '',
        'BTC RPC Node': process.env.BTC_RPC_URL ?? '',
      };
    } else {
      showMessageInfo = {
        'Account Name': accountName,
        'Account Role': 'BTC Validator',
        'Public Key': this.exsatAccountInfo.publicKey,
        'Gas Balance': btcBalance ? btcBalance : `0.00000000 BTC`,
        'Commission Rate': validator.commission_rate ? `${validator.commission_rate / 100}%` : '0%',
        'Commission Address': validator.reward_address ? `0x${validator.reward_address}` : '',
        'Total BTC Staked': validator.quantity,
        'Is eligible for consensus':
          parseFloat(validator.quantity) >= parseFloat(this.blkendtConfig.min_btc_qualification)
            ? 'Yes'
            : `No, requires staking at least ${this.blkendtConfig.min_btc_qualification}`,
        'Stake Address': validator.stake_address ? `0x${validator.stake_address}` : '',
        'BTC RPC Node': process.env.BTC_RPC_URL ?? '',
      };
    }
    showInfo(showMessageInfo);

    let menus = [
      {
        name: 'Change Stake Address',
        value: 'set_stake_address',
        description: 'Set/Change Stake Address',
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
    if (!validator.role) {
      menus.splice(
        1,
        0,
        {
          name: 'Change Commission Address',
          value: 'set_reward_address',
          description: 'Set/Change Commission Address',
        },
        {
          name: 'Change Commission Rate',
          value: 'set_commission_ratio',
          description: 'Set/Change Commission Rate',
        }
      );
    }
    const actions: { [key: string]: () => Promise<any> } = {
      set_reward_address: async () => await this.setRewardAddress(),
      set_stake_address: async () => await this.setStakeAddress(),
      set_commission_ratio: async () => await this.setCommissionRatio(),
      reset_btc_rpc: async () => await resetBtcRpcUrl(),
      export_private_key: async () => {
        return await exportPrivateKey(this.exsatAccountInfo.privateKey);
      },
      remove_account: async () => await removeKeystore(ClientType.Validator),
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
   * Sets the reward address for the validator.
   */
  async setRewardAddress() {
    const rewardAddress = await inputWithCancel('Enter commission address(Input "q" to return): ', (input: string) => {
      if (!isValidEvmAddress(input)) {
        return 'Please enter a valid address.';
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
      if (!isValidEvmAddress(input)) {
        return 'Please enter a valid address.';
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

    try {
      const res: any = await this.exsatApi.executeAction(ContractName.endrmng, 'evmsetstaker', data);
      if (res && res.transaction_id) {
        logger.info(`Set stake address: ${stakeAddress} successfully`);
        await this.updateValidatorInfo();
        return true;
      } else {
        logger.error(`Validator[${this.exsatAccountInfo.accountName}] Set stake address: ${stakeAddress} failed`);
        return false;
      }
    } catch (error) {
      return false;
    }
  }

  /**
   * Sets the commission ratio for the validator.
   */
  async setCommissionRatio() {
    const commissionRatio = await inputWithCancel(
      'Enter commission rate (0.00-100.00, Input "q" to return): ',
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
      commission_rate: parseFloat(commissionRatio) * 100,
    };
    const res: any = await this.exsatApi.executeAction(ContractName.endrmng, 'evmconfigvald', data);
    if (res && res.transaction_id) {
      await this.updateValidatorInfo();
      logger.info(`${Font.fgCyan}${Font.bright}Set commission rate: ${commissionRatio}% successfully.${Font.reset}\n`);
      return true;
    } else {
      logger.error(`Validator[${this.exsatAccountInfo.accountName}] Set commission rate: ${commissionRatio} failed`);
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
   * Decrypts the keystore and initializes exsatApi and tableApi.
   */
  async init() {
    this.exsatApi = new ExsatApi(this.exsatAccountInfo);
    await this.exsatApi.initialize();
    this.tableApi = await TableApi.getInstance();
    this.blkendtConfig = await this.tableApi.getBlkendtConfig();
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
        if (this.registration && process.env.SYNCHRONIZER_KEYSTORE_FILE === process.env.VALIDATOR_KEYSTORE_FILE) {
          const synchronizerInfo = await this.tableApi.getSynchronizerInfo(this.exsatAccountInfo.accountName);
          if (!synchronizerInfo) {
            updateEnvFile({ SYNCHRONIZER_KEYSTORE_FILE: '', SYNCHRONIZER_KEYSTORE_PASSWORD: '' });
          }
        }
        await this.registerValidator();
      }
      this.validatorInfo = await this.tableApi.getValidatorInfo(this.exsatAccountInfo.accountName);
    } else {
      this.validatorInfo = validatorInfo;
    }
  }

  /**
   * Checks if the reward address is set for the validator.
   */
  async checkRewardsAddress() {
    const accountName = this.exsatAccountInfo.accountName;
    const btcBalance = await this.tableApi.getAccountBalance(accountName);
    const validator = this.validatorInfo;
    if (!validator.reward_address && !validator.role) {
      logger.info('Commission address is not set.');
      let showMessageInfo = {
        'Account Name': accountName,
        'Account Role': 'BTC Validator',
        'Public Key': this.exsatAccountInfo.publicKey,
        'Gas Balance': btcBalance ? btcBalance : `0.00000000 BTC`,
        'Commission Rate': validator.commission_rate ? `${validator.commission_rate / 100}%` : '0%',
        'Commission Address': 'unset',
        'Total BTC Staked': validator.quantity,
        'Is eligible for consensus':
          parseFloat(validator.quantity) >= parseFloat(this.blkendtConfig.min_btc_qualification)
            ? 'Yes'
            : `No, requires staking at least ${this.blkendtConfig.min_btc_qualification}`,
        'Stake Address': validator.stake_address ? `0x${validator.stake_address}` : '',
        'BTC RPC Node': process.env.BTC_RPC_URL ?? '',
      };
      showInfo(showMessageInfo);

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
   * Checks if the BTC RPC URL is set and valid.
   */
  async checkBtcRpcNode() {
    const rpcUrl = process.env.BTC_RPC_URL;
    const accountName = this.exsatAccountInfo.accountName;
    const btcBalance = await this.tableApi.getAccountBalance(accountName);
    const validator = this.validatorInfo;
    if (!rpcUrl || !isValidUrl(rpcUrl)) {
      logger.info('BTC_RPC_URL is not set or is in an incorrect format');
      let showMessageInfo;
      if (validator.role) {
        showMessageInfo = {
          'Account Name': accountName,
          'Account Role': 'XSAT Validator',
          'Public Key': this.exsatAccountInfo.publicKey,
          'Gas Balance': btcBalance ? btcBalance : `0.00000000 BTC`,
          'Total XSAT Staked': validator.xsat_quantity,
          'Is eligible for consensus':
            parseFloat(validator.xsat_quantity) >= parseFloat(this.blkendtConfig.min_xsat_qualification)
              ? 'Yes'
              : `No, requires staking ${this.blkendtConfig.min_xsat_qualification}`,
          'Stake Address': validator.stake_address ? `0x${validator.stake_address}` : '',
          'BTC RPC Node': 'unset',
        };
      } else {
        showMessageInfo = {
          'Account Name': accountName,
          'Account Role': 'BTC Validator',
          'Public Key': this.exsatAccountInfo.publicKey,
          'Gas Balance': btcBalance ? btcBalance : `0.00000000 BTC`,
          'Commission Rate': validator.commission_rate ? `${validator.commission_rate / 100}%` : '0%',
          'Commission Address': validator.reward_address ? `0x${validator.reward_address}` : '',
          'Total BTC Staked': validator.quantity,
          'Is eligible for consensus':
            parseFloat(validator.quantity) >= parseFloat(this.blkendtConfig.min_btc_qualification)
              ? 'Yes'
              : `No, requires staking at least ${this.blkendtConfig.min_btc_qualification}`,
          'Stake Address': validator.stake_address ? `0x${validator.stake_address}` : '',
          'BTC RPC Node': 'unset',
        };
      }
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

  /**
   * Register a new validator.
   */
  async registerValidator() {
    const validatorRole = await select({
      message: 'Do you want to set up a BTC Validator or a XSAT Validator?',
      choices: [
        { name: 'BTC Validator', value: Client.Validator },
        { name: 'XSAT Validator', value: Client.XSATValidator },
      ],
    });
    const stakeAddress = await input({
      message: 'Enter your stake address: ',
      validate: (value) => {
        return isValidEvmAddress(value) ? true : 'Invalid address';
      },
    });
    let claimableAddress;
    let commissionRate;
    if (validatorRole === Client.Validator) {
      claimableAddress = await input({
        message: 'Enter your commission address: ',
        validate: (value) => {
          return isValidEvmAddress(value) ? true : 'Invalid address';
        },
      });
      commissionRate = await input({
        message: 'Enter your commission rate (0.00-100.00): ',
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
      role: validatorRole === Client.Validator ? 0 : 1,
      stake_addr: evmAddressToChecksum(stakeAddress),
      reward_addr: claimableAddress ? evmAddressToChecksum(claimableAddress) : null,
      commission_rate: commissionRate ? parseFloat(commissionRate) * 100 : null,
    };

    const res: any = await this.exsatApi.executeAction(ContractName.endrmng, 'newregvldtor', data);
    await sleep(1000);

    return res;
  }
}
