import { configureLogger, logger } from '../utils/logger';
import { select } from '@inquirer/prompts';
import { SynchronizerCommander } from './synchronizer';
import { ValidatorCommander } from './validator';
import { Version } from '../utils/version';
import {
  checkAccountRegistrationStatus,
  decryptKeystore,
  getKeystoreBaseInfo,
  notAccountMenu,
  updateMenu,
} from './common';
import { Client, ClientType, KeystoreExistStatus } from '../utils/enumeration';
import { isExsatDocker, loadNetworkConfigurations, reloadEnv, showInfo } from '../utils/common';
import { NETWORK_CONFIG } from '../utils/config';
import { keystoreExistStatus } from '../utils/keystore';
import { getInputRole } from './account';

/**
 * Main entry point for the application.
 * Checks for updates, displays user guide information, and prompts user to select a client to start.
 */
async function main() {
  await loadNetworkConfigurations();
  showInfo({
    'Please note':
      'It is highly recommended that you carefully read the user guide and follow the instructions precisely to avoid any unnecessary issues.',
    'User Guide': `${NETWORK_CONFIG.userGuide}`,
  });

  let keystoreEXistStatus = keystoreExistStatus();

  while (keystoreEXistStatus === KeystoreExistStatus.None) {
    if (keystoreEXistStatus === KeystoreExistStatus.None) {
      await notAccountMenu();
    }
    reloadEnv();
    keystoreEXistStatus = keystoreExistStatus();
  }
  let clientCommander;
  let role;
  let exsatAccount;
  switch (keystoreEXistStatus) {
    case KeystoreExistStatus.Validator:
      role = Client.Validator;
      exsatAccount = await decryptKeystore(ClientType.Validator);
      clientCommander = new ValidatorCommander(exsatAccount);
      break;
    case KeystoreExistStatus.Synchronizer:
      role = Client.Synchronizer;
      exsatAccount = await decryptKeystore(ClientType.Synchronizer);
      clientCommander = new SynchronizerCommander(exsatAccount);
      break;
    case KeystoreExistStatus.Both:
      if (process.env.SYNCHRONIZER_KEYSTORE_FILE == process.env.VALIDATOR_KEYSTORE_FILE) {
        const baseInfo = await getKeystoreBaseInfo(ClientType.Synchronizer);
        await checkAccountRegistrationStatus(baseInfo);
      }
      role = await getInputRole('Do you want to set up a Synchronizer or a Validator?');
      switch (role) {
        case Client.Validator:
          exsatAccount = await decryptKeystore(ClientType.Validator);
          clientCommander = new ValidatorCommander(exsatAccount, true);
          break;
        case Client.Synchronizer:
          exsatAccount = await decryptKeystore(ClientType.Synchronizer);
          clientCommander = new SynchronizerCommander(exsatAccount, true);
          break;
      }
      break;
    default:
      break;
  }

  const isDocker = isExsatDocker();
  // Check for software updates
  let versions;
  if (isDocker) {
    versions = await Version.checkForDockerUpdates();
  } else {
    versions = await Version.checkForUpdates();
  }
  if (versions.newVersion) {
    await updateMenu(versions, isDocker, role);
  }

  // Start the selected client
  await clientCommander.main();
}

// Execute the main function and handle any errors
(async () => {
  try {
    configureLogger('commander');
    await main();
  } catch (e) {
    logger.error(e);
  }
})();
