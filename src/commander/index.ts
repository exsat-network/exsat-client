import { configureLogger, logger } from '../utils/logger';
import { select } from '@inquirer/prompts';
import { SynchronizerCommander } from './synchronizer';
import { ValidatorCommander } from './validator';
import { Version } from '../utils/version';
import { notAccountMenu, updateMenu } from './common';
import { Client, KeystoreExistStatus } from '../utils/enumeration';
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

  while (keystoreEXistStatus === KeystoreExistStatus.None || keystoreEXistStatus === KeystoreExistStatus.Both) {
    if (keystoreEXistStatus === KeystoreExistStatus.None) {
      await notAccountMenu();
    }
    reloadEnv();
    keystoreEXistStatus = keystoreExistStatus();
  }
  let clientCommander;
  let role;
  switch (keystoreEXistStatus) {
    case KeystoreExistStatus.Validator:
      role = Client.Validator;
      clientCommander = new ValidatorCommander();
      break;
    case KeystoreExistStatus.Synchronizer:
      role = Client.Synchronizer;
      clientCommander = new SynchronizerCommander();
      break;
    case KeystoreExistStatus.Both:
      role = await getInputRole();
      switch (role) {
        case Client.Validator:
          clientCommander = new ValidatorCommander(true);
          break;
        case Client.Synchronizer:
          clientCommander = new SynchronizerCommander(true);
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
  configureLogger('commander');
  await clientCommander.main();
}

// Execute the main function and handle any errors
(async () => {
  try {
    await main();
  } catch (e) {
    logger.error(e);
  }
})();
