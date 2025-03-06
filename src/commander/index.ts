import { configureLogger, logger } from '../utils/logger';
import { SynchronizerCommander } from './synchronizer';
import { ValidatorCommander } from './validator';
import { Version } from '../utils/version';
import { checkAccountRegistrationStatus, getKeystoreBaseInfo, notAccountMenu, updateMenu } from './common';
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
  const isDocker = isExsatDocker();

  showInfo({
    'Please note':
      'It is highly recommended that you carefully read the user guide and follow the instructions precisely to avoid any unnecessary issues.',
    'User Guide': `${NETWORK_CONFIG.userGuide}`,
  });

  // Check for client updates
  let versions;
  if (isDocker) {
    versions = await Version.checkForDockerUpdates();
  } else {
    versions = await Version.checkForUpdates();
  }
  if (versions.newVersion) {
    await updateMenu(versions, isDocker);
  }

  let keystoreStatus = keystoreExistStatus();
  while (keystoreStatus === KeystoreExistStatus.None) {
    await notAccountMenu();
    reloadEnv();
    keystoreStatus = keystoreExistStatus();
  }
  let clientCommander;
  let role;
  // Determine the client type based on the keystore status
  switch (keystoreStatus) {
    case KeystoreExistStatus.Validator:
      role = Client.Validator;
      clientCommander = new ValidatorCommander();
      break;
    case KeystoreExistStatus.Synchronizer:
      role = Client.Synchronizer;
      clientCommander = new SynchronizerCommander();
      break;
    case KeystoreExistStatus.Both:
      let registration = false;
      if (process.env.SYNCHRONIZER_KEYSTORE_FILE === process.env.VALIDATOR_KEYSTORE_FILE) {
        registration = true;
        const baseInfo = await getKeystoreBaseInfo(ClientType.Synchronizer);
        await checkAccountRegistrationStatus(baseInfo);
      }
      role = await getInputRole('Do you want to set up a Synchronizer or a Validator?');
      switch (role) {
        case Client.Validator:
          clientCommander = new ValidatorCommander(registration);
          break;
        case Client.Synchronizer:
          clientCommander = new SynchronizerCommander(registration);
          break;
      }
      break;
    default:
      break;
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
    logger.error('An unhandled error occurred:', e);
  }
})();
