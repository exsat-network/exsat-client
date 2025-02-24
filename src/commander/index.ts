import { configureLogger, logger } from '../utils/logger';
import { select } from '@inquirer/prompts';
import { SynchronizerCommander } from './synchronizer';
import { ValidatorCommander } from './validator';
import { Version } from '../utils/version';
import { notAccountMenu, updateMenu } from './common';
import { Client, KeystoreExistStatus } from '../utils/enumeration';
import { isExsatDocker, loadNetworkConfigurations, showInfo } from '../utils/common';
import { NETWORK_CONFIG } from '../utils/config';
import { keystoreExistStatus } from '../utils/keystore';

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
  const keystoreEXistStatus = keystoreExistStatus();
  switch (keystoreEXistStatus) {
    case KeystoreExistStatus.None:
      await notAccountMenu();
      break;
    case KeystoreExistStatus.Validator:
    case KeystoreExistStatus.Synchronizer:
      break;
    case KeystoreExistStatus.Both:
      break;
    default:
      break;
  }

  // Define menu options for client selection
  const menus = [
    { name: 'Synchronizer', value: Client.Synchronizer },
    { name: 'BTC Validator', value: Client.Validator },
    { name: 'XSAT Validator', value: Client.XSATValidaotr },
  ];
  // Prompt user to select a client to start
  const role = await select({
    message: 'Please select a role to start: ',
    choices: menus,
  });

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
  // Initialize the selected client and configure logger
  let clientCommander;
  switch (role) {
    case Client.Synchronizer:
      clientCommander = new SynchronizerCommander();
      break;
    case Client.Validator:
    case Client.XSATValidaotr:
      clientCommander = new ValidatorCommander(role);
      break;
    default:
      throw new Error('Invalid client selection');
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
