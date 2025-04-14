import TableApi from '../utils/table-api';
import ExsatApi from '../utils/exsat-api';
import { PublicKey } from '@wharfkit/antelope';

import {
  checkAccountRegistrationStatus,
  decryptKeystore,
  exportPrivateKey,
  promptMenuLoop,
  removeKeystore,
  resetBtcRpcUrl,
  setBtcRpcUrl,
  stakeClaimManagement,
} from './common';
import process from 'node:process';
import { isValidEvmAddress, isValidUrl, removeTrailingZeros, showInfo, sleep, updateEnvFile } from '../utils/common';
import { confirm, input, select, Separator } from '@inquirer/prompts';
import { logger } from '../utils/logger';
import { inputWithCancel } from '../utils/input';
import { Client, ClientType, ContractName } from '../utils/enumeration';
import { Font } from '../utils/font';
import { evmAddressToChecksum } from '../utils/key';

export class ValidatorCommander {
  private exsatAccountInfo: any;
  private validatorInfo: any;
  private tableApi: TableApi;
  private exsatApi: ExsatApi;
  private blkendtConfig: any;
  private registration: boolean;

  constructor(registration = false) {
    this.registration = registration;
  }

  /**
   * Main entry point for the ValidatorCommander.
   * Checks the keystore, initializes APIs, and manages the validator menu.
   */
  async main() {
    await checkAccountRegistrationStatus(ClientType.Validator);
    // Initialize APIs and check account and validator status
    await this.init();
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
    const validator = this.validatorInfo;
    let showMessageInfo = await this.getShowMessageInfo(validator);

    showInfo(showMessageInfo);

    let menus = [
      {
        name: 'Stake or Claim Management',
        value: 'stake_claim_management',
        description: 'A Link To Stake or Claim Management',
      },
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
      {
        name: 'Update Auth',
        value: 'update_auth',
        description: 'Add Public Key',
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
    const client = validator.role ? Client.XSATValidator : Client.Validator;
    const actions: { [key: string]: () => Promise<any> } = {
      stake_claim_management: async () => await stakeClaimManagement(client),
      set_reward_address: async () => await this.setRewardAddress(),
      set_stake_address: async () => await this.setStakeAddress(),
      set_commission_ratio: async () => await this.setCommissionRatio(),
      update_auth: async () => await this.updateAuth(),
      reset_btc_rpc: async () => await resetBtcRpcUrl(),
      export_private_key: async () => {
        return await exportPrivateKey(this.exsatAccountInfo.privateKey);
      },
      remove_account: async () => await removeKeystore(ClientType.Validator),
      quit: async () => process.exit(),
    };
    await promptMenuLoop(menus, actions, 'Select an Action', true);
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
    try {
      await this.exsatApi.executeAction(ContractName.endrmng, 'setrwdaddr', data);
      logger.info(`Set commission address: ${rewardAddress} successfully`);
      await this.updateValidatorInfo();
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Sets the stake address for the validator.
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
      await this.exsatApi.executeAction(ContractName.endrmng, 'evmsetstaker', data);
      logger.info(`Set stake address: ${stakeAddress} successfully`);
      await this.updateValidatorInfo();
      return true;
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
    try {
      await this.exsatApi.executeAction(ContractName.endrmng, 'evmconfigvald', data);
      await this.updateValidatorInfo();
      logger.info(`${Font.fgCyan}${Font.bright}Set commission rate: ${commissionRatio}% successfully.${Font.reset}\n`);
      return true;
    } catch (e) {
      return false;
    }
  }


  validatePublicKey(key) {
    try {
      PublicKey.from(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  async updateAuth() {
    const pubkey = await input({
      message: 'Enter an new publicKey(PUB_K1_5Rxxxxxx): ',
      validate: async (input) => {
        if (input === 'q') return true;
        if (!this.validatePublicKey(input)) {
          return 'Please enter a new publicKey etc: PUB_K1_5Rxxxxxx.';
        }
        return true;
      },
    });

    const sortedKeys = [
      { key: pubkey, weight: 1 },
      { key: this.exsatAccountInfo.publicKey, weight: 1 }
    ].sort((a, b) => a.key.localeCompare(b.key));
  
    const ownerData = {
      account: this.exsatAccountInfo.accountName,
      permission: 'owner',
      parent: '',
      auth: {
        threshold: 1,
        keys: sortedKeys,
        accounts: [],
        waits: []
      }
    };
  
    const activeData = {
      account: this.exsatAccountInfo.accountName,
      permission: 'active',
      parent: 'owner',
      auth: {
        threshold: 1,
        keys: sortedKeys,
        accounts: [],
        waits: []
      }
    };
  
    try {
      await this.exsatApi.executeActionByPermission('eosio', 'updateauth', ownerData);
      await this.exsatApi.executeActionByPermission('eosio', 'updateauth', activeData);
      await this.updateValidatorInfo();
      logger.info(`${Font.fgCyan}${Font.bright}Update Auth to: ${pubkey}% successfully.${Font.reset}\n`);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Decrypts the keystore and initializes exsatApi and tableApi.
   */
  async init() {
    this.exsatAccountInfo = await decryptKeystore(ClientType.Validator);
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
        if (this.registration) {
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
    if (!this.validatorInfo.reward_address && !this.validatorInfo.role) {
      logger.info('Commission address is not set.');
      await this.handleMissingSetting('Commission Address', 'set_reward_address');
    } else {
      logger.info('Commission address is already set correctly.');
    }
  }

  /**
   * Checks if the BTC RPC URL is set and valid.
   */
  async checkBtcRpcNode() {
    const rpcUrl = process.env.BTC_RPC_URL;
    if (!rpcUrl || !isValidUrl(rpcUrl)) {
      logger.info('BTC_RPC_URL is not set or is in an incorrect format');
      await this.handleMissingSetting('BTC RPC Node', 'set_btc_rpc');
    } else {
      logger.info('BTC_RPC_URL is already set correctly.');
    }
  }

  /**
   * Update the validator info.
   */
  async updateValidatorInfo(delay = 1000) {
    await sleep(delay);
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

    try {
      const res: any = await this.exsatApi.executeAction(ContractName.endrmng, 'newregvldtor', data);
      await this.updateValidatorInfo();
      return res;
    } catch (e: any) {
      logger.error(`Failed to register validator: ${e.message}`);
      return null;
    }
  }

  /**
   * Get the show message info.
   * @param validator
   * @private
   */
  private async getShowMessageInfo(validator: any) {
    const accountName = this.exsatAccountInfo.accountName;
    const btcBalance = await this.tableApi.getAccountBalance(accountName);

    if (validator.role) {
      return {
        'Account Name': accountName,
        'Account Role': 'XSAT Validator',
        'Public Key': this.exsatAccountInfo.publicKey,
        'Gas Balance': btcBalance ? removeTrailingZeros(btcBalance) : `0 BTC`,
        'Total XSAT Staked': removeTrailingZeros(validator.xsat_quantity),
        'Is eligible for consensus':
          parseFloat(validator.xsat_quantity) >= parseFloat(this.blkendtConfig.min_xsat_qualification)
            ? 'Yes'
            : `No, requires staking ${removeTrailingZeros(this.blkendtConfig.min_xsat_qualification)}`,
        'Stake Address': validator.stake_address ? `0x${validator.stake_address}` : '',
        'BTC RPC Node': isValidUrl(process.env.BTC_RPC_URL) ? process.env.BTC_RPC_URL : 'Invalid',
      };
    } else {
      return {
        'Account Name': accountName,
        'Account Role': 'BTC Validator',
        'Public Key': this.exsatAccountInfo.publicKey,
        'Gas Balance': btcBalance ? removeTrailingZeros(btcBalance) : `0 BTC`,
        'Commission Rate': validator.commission_rate ? `${validator.commission_rate / 100}%` : '0%',
        'Commission Address': validator.reward_address ? `0x${validator.reward_address}` : 'Unset',
        'Total BTC Staked': removeTrailingZeros(validator.quantity),
        'Is eligible for consensus':
          parseFloat(validator.quantity) >= parseFloat(this.blkendtConfig.min_btc_qualification)
            ? 'Yes'
            : `No, requires staking at least ${removeTrailingZeros(this.blkendtConfig.min_btc_qualification)}`,
        'Stake Address': validator.stake_address ? `0x${validator.stake_address}` : '',
        'BTC RPC Node': isValidUrl(process.env.BTC_RPC_URL) ? process.env.BTC_RPC_URL : 'Invalid',
      };
    }
  }

  /**
   * Handles missing settings for a validator.
   * @param settingName
   * @param actionKey
   * @private
   */
  private async handleMissingSetting(settingName: string, actionKey: string) {
    let showMessageInfo = await this.getShowMessageInfo(this.validatorInfo);
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
