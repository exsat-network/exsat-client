import TableApi from '../utils/table-api';
import ExsatApi from '../utils/exsat-api';
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
import {
  isValidEvmAddress,
  isValidUrl,
  removeTrailingZeros,
  showInfo,
  sleep,
  updateEnvFile,
  getBtcAddressNetwork,
  isValidCommissionRate,
  isValidEmail,
  isValidTxid,
  isAllZero,
} from '../utils/common';
import { confirm, input, select, Separator } from '@inquirer/prompts';
import { logger } from '../utils/logger';
import { inputWithCancel } from '../utils/input';
import { Client, ClientType, ContractName, VerificationStatus } from '../utils/enumeration';
import { Font } from '../utils/font';
import { evmAddressToChecksum } from '../utils/key';
import { EVM_ZERO_ADDRESS, RSA_PUBLIC_KEY } from '../utils/constant';
import { getTransaction, getUtxoBalance } from '../utils/mempool';
import { RSAUtil } from '../utils/rsa.util';
import { leftPadInput } from '../utils/common';
import { NETWORK } from '../utils/config';

export class ValidatorCommander {
  private exsatAccountInfo: any;
  private validatorInfo: any;
  private isCreditStaker: boolean = false;
  private creditStakingInfo: {
    random?: string;
    hasVerification?: boolean;
    verificationStatus?: VerificationStatus;
  } = {};
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

    // Add Stake Address option for Non Credit-based BTC Validator
    if (!validator.role && !this.isCreditStaker) {
      menus.splice(1, 0, {
        name: 'Change Stake Address',
        value: 'set_stake_address',
        description: 'Set/Change Stake Address',
      });
    }

    if (!validator.role) {
      const rewardAddressMenuName = this.isCreditStaker ? 'Change Reward Address' : 'Change Commission Reward Address';

      menus.splice(
        1,
        0,
        {
          name: rewardAddressMenuName,
          value: 'set_reward_address',
          description: this.isCreditStaker ? 'Set/Change Reward Address' : 'Set/Change Commission Reward Address',
        },
        {
          name: 'Change Commission Rate',
          value: 'set_commission_ratio',
          description: 'Set/Change Commission Rate',
        }
      );
    }

    // Add special menu for Credit-based BTC Validator
    if (!validator.role && this.isCreditStaker) {
      const { hasVerification, verificationStatus } = this.creditStakingInfo;

      if (hasVerification) {
        menus.splice(0, 0, {
          name: 'Check Transaction Verification Status',
          value: 'check_verification_status',
          description: 'Check Transaction Verification Status',
        });

        if (verificationStatus === VerificationStatus.Rejected) {
          menus.splice(1, 0, {
            name: 'Verify Self-Custodied BTC Address',
            value: 'verify_btc_address',
            description: 'Verify Self-Custodied BTC Address',
          });
        }
      } else {
        menus.splice(0, 0, {
          name: 'Verify Self-Custodied BTC Address',
          value: 'verify_btc_address',
          description: 'Verify Self-Custodied BTC Address',
        });
      }
    }

    const client = validator.role ? Client.XSATValidator : Client.Validator;
    const actions: { [key: string]: () => Promise<any> } = {
      stake_claim_management: async () => await stakeClaimManagement(client),
      set_reward_address: async () => await this.setRewardAddress(),
      set_stake_address: async () => await this.setStakeAddress(),
      set_commission_ratio: async () => await this.setCommissionRatio(),
      reset_btc_rpc: async () => await resetBtcRpcUrl(),
      export_private_key: async () => {
        return await exportPrivateKey(this.exsatAccountInfo.privateKey);
      },
      remove_account: async () => await removeKeystore(ClientType.Validator),
      verify_btc_address: async () => await this.selectToVerifyBtcAddress(),
      check_verification_status: async () => await this.checkVerificationStatus(),
      quit: async () => process.exit(),
    };
    await promptMenuLoop(menus, actions, 'Select an Action', true);
  }

  /**
   * Sets the reward address for the validator.
   */
  async setRewardAddress() {
    const message = this.isCreditStaker
      ? 'Enter reward address (Input "q" to return): '
      : 'Enter commission reward address (Input "q" to return): ';

    const rewardAddress = await inputWithCancel(message, (input: string) => {
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
      const successMessage = this.isCreditStaker
        ? `Set reward address: ${rewardAddress} successfully`
        : `Set commission reward address: ${rewardAddress} successfully`;
      logger.info(successMessage);
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
    if (this.isCreditStaker) {
      console.log('Credit Stakers do not need to set stake address.');
      return false;
    }

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
        if (!isValidCommissionRate(value)) {
          return 'Please enter a valid number between 0.00 and 100.00';
        }
        return true;
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

  /**
   * Select to verify BTC address.
   */
  async selectToVerifyBtcAddress() {
    if (this.creditStakingInfo.verificationStatus === VerificationStatus.Rejected) {
      // Call contract enroll to refresh random number
      const enrollResult = await this.exsatApi.executeAction(ContractName.custody, 'enroll', {
        account: this.exsatAccountInfo.accountName,
      });

      this.creditStakingInfo.random = String(enrollResult.processed.action_traces[0].return_value_data);
    }

    await this.verifyBtcAddress();

    // Refresh the menu
    await this.managerMenu();
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
   * Check the credit staking status of the validator.
   */
  async checkCreditStakingStatus() {
    const enrollmentInfo = await this.tableApi.getEnrollmentInfo(this.exsatAccountInfo.accountName);
    if (!enrollmentInfo) {
      // Validator is not a credit staker
      this.isCreditStaker = false;
      return;
    }

    this.isCreditStaker = true;
    this.creditStakingInfo.random = String(enrollmentInfo.random);

    // Check if the credit staker has verification
    if (isAllZero(enrollmentInfo.txid)) {
      this.creditStakingInfo.hasVerification = false;
    } else {
      this.creditStakingInfo.hasVerification = true;
      this.creditStakingInfo.verificationStatus = enrollmentInfo.is_valid;
    }
  }

  /**
   * Checks if the reward address is set for the validator.
   */
  async checkRewardsAddress() {
    if (!this.validatorInfo.reward_address && !this.validatorInfo.role) {
      const settingName = this.isCreditStaker ? 'Reward Address' : 'Commission Reward Address';
      logger.info(`${settingName} is not set.`);
      await this.handleMissingSetting(settingName, 'set_reward_address');
    } else {
      const settingName = this.isCreditStaker ? 'Reward address' : 'Commission reward address';
      logger.info(`${settingName} is already set correctly.`);
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

    let selectCreditStaking = false;
    let stakeAddress;
    let claimableAddress;
    let commissionRate;

    if (validatorRole === Client.Validator) {
      const stakingMethod = await select({
        message: 'Please choose your BTC staking method:',
        choices: [
          { name: 'Verify your self-custodied BTC address', value: 'self_custodied' },
          { name: 'Bridge your BTC to exSat Network to stake (Higher Reward)', value: 'bridge' },
        ],
      });

      selectCreditStaking = stakingMethod === 'self_custodied';

      if (selectCreditStaking) {
        stakeAddress = EVM_ZERO_ADDRESS;
      } else {
        stakeAddress = await input({
          message: 'Enter your stake address: ',
          validate: (value) => {
            return isValidEvmAddress(value) ? true : 'Invalid address';
          },
        });
      }

      claimableAddress = await input({
        message: `Enter your ${selectCreditStaking ? 'reward address' : 'commission reward address'}: `,
        validate: (value) => {
          return isValidEvmAddress(value) ? true : 'Invalid address';
        },
      });
      commissionRate = await input({
        message: 'Enter your commission rate (0.00-100.00): ',
        validate: (value) => {
          if (!isValidCommissionRate(value)) {
            return 'Please enter a valid number between 0.00 and 100.00';
          }
          return true;
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
      if (selectCreditStaking) {
        // register and enroll for Credit-based BTC Validator
        const actions = [
          {
            account: ContractName.endrmng,
            name: 'newregvldtor',
            data,
          },
          {
            account: ContractName.custody,
            name: 'enroll',
            data: { account: this.exsatAccountInfo.accountName },
          },
        ];
        const res = await this.exsatApi.executeActions(actions);

        // update validator info
        await this.updateValidatorInfo();
        this.creditStakingInfo.random = String(res.processed.action_traces[1].return_value_data);

        // verify btc address
        await this.verifyBtcAddress();
      } else {
        await this.exsatApi.executeAction(ContractName.endrmng, 'newregvldtor', data);

        await this.updateValidatorInfo();
      }
    } catch (error: any) {
      logger.error(`Failed to register validator: ${error.message}`);
      await input({ message: 'Press [Enter] to continue...' });
    }
  }

  /**
   * Get the show message info.
   * @param validator
   * @private
   */
  private async getShowMessageInfo(validator: any) {
    await this.checkCreditStakingStatus();

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
      // BTC Validator
      const baseInfo = {
        'Account Name': accountName,
        'Account Role': 'BTC Validator',
        'Public Key': this.exsatAccountInfo.publicKey,
        'Gas Balance': btcBalance ? removeTrailingZeros(btcBalance) : `0 BTC`,
        'Commission Rate': validator.commission_rate ? `${validator.commission_rate / 100}%` : '0%',
        'Total BTC Staked': removeTrailingZeros(validator.quantity),
        'Is eligible for consensus':
          parseFloat(validator.quantity) >= parseFloat(this.blkendtConfig.min_btc_qualification)
            ? 'Yes'
            : `No, requires staking at least ${removeTrailingZeros(this.blkendtConfig.min_btc_qualification)}`,
        'BTC RPC Node': isValidUrl(process.env.BTC_RPC_URL) ? process.env.BTC_RPC_URL : 'Invalid',
      };

      if (this.isCreditStaker) {
        if (this.creditStakingInfo.verificationStatus === VerificationStatus.Approved) {
          baseInfo['Is eligible for consensus'] = 'Yes';
        }

        return {
          ...baseInfo,
          'Staking Method': 'Self-Custodied BTC Address',
          'Reward Address': validator.reward_address ? `0x${validator.reward_address}` : 'Unset',
        };
      } else {
        return {
          ...baseInfo,
          'Staking Method': 'Bridge BTC to exSat Network',
          'Stake Address': validator.stake_address ? `0x${validator.stake_address}` : '',
          'Commission Reward Address': validator.reward_address ? `0x${validator.reward_address}` : 'Unset',
        };
      }
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

  /**
   * Verify self-custodied BTC address.
   */
  async verifyBtcAddress() {
    try {
      showInfo({
        'BTC Address Verification': `Please prepare a BTC address with more than 100 BTC as your credit staked BTC address. And use this credit staked BTC address send out ${leftPadInput(this.creditStakingInfo.random, 8, 'x')} BTC (x means any number, for example ${leftPadInput(this.creditStakingInfo.random, 8, '0')} BTC) to any address for verifying the ownership. After finished the transaction, please input the BTC address and the transaction Id.`,
      });

      const btcAddress = await inputWithCancel(
        'Input BTC address (with more than 100 BTC amount, Input "q" to return): ',
        async (input: string) => {
          if (!getBtcAddressNetwork(input)) {
            return 'Please enter a valid BTC address.';
          }

          const isValidBalance = await this.validateBtcBalance(input);
          if (!isValidBalance) {
            return 'The balance of your inputted BTC address is less than 100 BTC. Please input a valid BTC address.';
          }

          return true;
        }
      );

      if (!btcAddress) {
        return false;
      }

      const transactionId = await inputWithCancel('Input Transaction Id (Input "q" to return):  ', async (input: string) => {
        if (!isValidTxid(input)) {
          return 'Please enter a valid transaction ID (64 characters).';
        }

        const validationResult = await this.validateTransaction(btcAddress, input, this.creditStakingInfo.random);
        if (!validationResult.success) {
          return validationResult.reason;
        }

        return true;
      });

      if (!transactionId) {
        return false;
      }

      // Call contract verifytx to submit verification information
      await this.exsatApi.executeAction(ContractName.custody, 'verifytx', {
        account: this.exsatAccountInfo.accountName,
        btc_address: btcAddress,
        txid: transactionId,
        information: '',
      });

      this.creditStakingInfo.hasVerification = true;
      this.creditStakingInfo.verificationStatus = VerificationStatus.Pending;

      showInfo({
        'Verification Submitted':
          'You have completely input the verification information, your transaction will be verified in 24 hours. Please go to "Check Transaction Verification Status" action to check the verification status or input your email to receive verification result.',
      });

      const email = await inputWithCancel(
        'Input your email to receive verification result (optional): ',
        (input: string) => {
          if (!isValidEmail(input)) {
            return 'Please enter a valid email address.';
          }
          return true;
        }
      );

      if (email) {
        // Encrypt the email
        const encryptedEmail = RSAUtil.encrypt(email, RSA_PUBLIC_KEY);

        await this.exsatApi.executeAction(ContractName.custody, 'verifytx', {
          account: this.exsatAccountInfo.accountName,
          btc_address: btcAddress,
          txid: transactionId,
          information: encryptedEmail,
        });

        showInfo({
          'Email Setted': `Your email ${email} has been set for receiving verification result.`,
        });
      }

      await input({ message: 'Press [Enter] to continue...' });

      return true;
    } catch (error: any) {
      logger.error(`Failed to submit verification: ${error.message}`);
      await input({ message: 'Press [Enter] to continue...' });
      return false;
    }
  }

  /**
   * Check verification status.
   */
  async checkVerificationStatus() {
    try {
      const enrollmentInfo = await this.tableApi.getEnrollmentInfo(this.exsatAccountInfo.accountName);

      switch (enrollmentInfo.is_valid) {
        case VerificationStatus.Pending:
          showInfo({
            'Verification Status':
              'Your verification request is still under review. Please come back later and check again.',
          });
          break;
        case VerificationStatus.Approved:
          showInfo({
            'Verification Status':
              'Your verification request is successfully approved, please go to the consensus portal (https://portal.exsat.network/) and login with your Reward Address (your EVM address, not your BTC address) for more details.',
          });
          break;
        case VerificationStatus.Rejected:
          const requiredRandom = `${leftPadInput(enrollmentInfo.random, 8, 'x')} BTC`;
          const reason = this.getVerificationFailureReason(enrollmentInfo.verification_result, requiredRandom);
          showInfo({
            'Verification Failed': `We are sorry to inform you that your verification status is failed. The reason is that ${reason}. If you want to reverify, please go to "Verify Self-Custodied BTC Address" action.`,
          });
          break;
      }

      await input({ message: 'Press [Enter] to continue...' });

      if (this.creditStakingInfo.verificationStatus !== enrollmentInfo.is_valid) {
        // Refresh the menu
        await this.managerMenu();
      }

      return true;
    } catch (error: any) {
      logger.error(`Failed to check verification status: ${error.message}`);
      await input({ message: 'Press [Enter] to continue...' });
      return false;
    }
  }

  /**
   * Validate transaction using mempool API.
   * @private
   */
  private async validateTransaction(
    btcAddress: string,
    transactionId: string,
    mantissa: string
  ): Promise<{ success: boolean; reason?: string }> {
    try {
      const transaction = await getTransaction(transactionId);
      if (!transaction) {
        return {
          success: false,
          reason: 'The transaction is not valid.',
        };
      }

      const fromAddress = transaction.vin[0].prevout.scriptpubkey_address;
      const amount = transaction.vout[0].value;

      if (fromAddress !== btcAddress) {
        return {
          success: false,
          reason: 'The BTC address from your inputted transaction is not consistent with the BTC address you inputted.',
        };
      }

      if (amount.toString().slice(-mantissa.length) !== mantissa) {
        return {
          success: false,
          reason: `The transferred amount of your inputted transaction id does not match the amount we required (${leftPadInput(mantissa, 8, 'x')} BTC).`,
        };
      }
      if (NETWORK === 'mainnet') {
        // Check if the transaction is within the verification period
        const enrollmentInfo = await this.tableApi.getEnrollmentInfo(this.exsatAccountInfo.accountName);
        if (
          transaction.status.block_height < enrollmentInfo.start_height ||
          transaction.status.block_height > enrollmentInfo.end_height
        ) {
          return {
            success: false,
            reason: `The BTC block height of your inputted transaction(${transaction.status.block_height}) exceeds the block height range(from ${enrollmentInfo.start_height} to ${enrollmentInfo.end_height}) we required.`,
          };
        }
      }

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        reason: 'Failed to validate transaction.',
      };
    }
  }

  /**
   * Validate balance of the BTC address is more than 100 BTC.
   * @private
   */
  private async validateBtcBalance(btcAddress: string): Promise<boolean> {
    const balance = await getUtxoBalance(btcAddress);

    return balance >= 10000000000;
  }

  /**
   * Get verification failure reason.
   * @private
   */
  private getVerificationFailureReason(verificationResult: string, requiredRandom: string): string {
    const reasons = {
      1: 'the balance of your inputted BTC address is less than 100 BTC',
      2: `the transferred amount of your inputted transaction id does not match the amount we required (${requiredRandom})`,
      3: 'your BTC address has already staked at other protocol',
      4: 'your BTC address does not pass fraud check or AML check',
    };

    return reasons[verificationResult] || verificationResult;
  }
}
