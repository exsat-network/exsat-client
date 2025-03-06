import { input, confirm, select } from '@inquirer/prompts';
import path from 'path';
import { promisify } from 'node:util';
import os from 'node:os';
import fs from 'fs-extra';
import { isExsatDocker } from './common';

export async function inputWithCancel(
  message: string,
  validatefn?: (value: string) => boolean | string | Promise<string | boolean>
) {
  let value = await input({
    message: message,
    validate: (input) => {
      if (input.trim().toLowerCase() === 'q') {
        return true;
      }
      if (typeof validatefn === 'function') {
        return validatefn(input);
      }
      return true;
    },
  });
  value = value.trim();
  if (value.toLowerCase() === 'q') {
    return false;
  }
  return value;
}

export function clearLines(numLines: number) {
  for (let i = 0; i < numLines; i++) {
    process.stdout.write('\x1B[2K'); // Clear current line
    process.stdout.write('\x1B[1A'); // Move cursor up one line
  }
  process.stdout.write('\x1B[2K'); // Clear current line
}

export const listDirectories = async (currentPath: string) => {
  const files = await fs.readdir(currentPath);
  const directories = files.filter((file) => fs.statSync(path.join(currentPath, file)).isDirectory());
  directories.unshift('..'); // Add parent directory option
  directories.unshift('.'); // Add current directory option
  return directories;
};

const access = promisify(fs.access);
const mkdir = promisify(fs.mkdir);

async function checkAndCreatePath(directoryPath: string): Promise<void> {
  const parentDir = path.dirname(directoryPath);

  if (fs.existsSync(directoryPath)) {
    return; // Directory already exists
  }
  if (directoryPath === parentDir) {
    // Reached the root directory, stop recursion
    throw new Error('Cannot create directory at the root level.');
  }
  if (!fs.existsSync(parentDir)) {
    // Recursively check and create the parent directory
    await checkAndCreatePath(parentDir);
  }

  // Check if we have permission to create the directory
  await access(parentDir, fs.constants.W_OK);

  // Create the directory
  await mkdir(directoryPath);
}

export const selectDirPrompt = async () => {
  let rootPath;
  let choices;
  if (!isExsatDocker()) {
    rootPath = path.resolve(os.homedir() + '/.exsat');
    choices = [
      { name: `Home Path(path: ${rootPath})`, value: '2' },
      { name: 'Navigate To Select', value: '1' },
      { name: 'Manually Enter a Directory Path', value: '3' },
    ];
  } else {
    rootPath = path.resolve('/app/.exsat');
    choices = [
      { name: `Root Path(path: ${rootPath})`, value: '2' },
      { name: 'Manually Enter a Directory Path', value: '3' },
    ];
  }
  const initialChoice = await select({
    message: '\nChoose a directory to save the keystore: ',
    choices: choices,
  });

  if (initialChoice === '3') {
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        const manualPath = await input({
          message: 'Please enter the directory path: ',
        });

        await checkAndCreatePath(manualPath);
        return manualPath;
      } catch (error) {
        attempts++;
        if (attempts < maxAttempts) {
          console.log('Invalid directory path or insufficient permissions. Please try again.');
        } else {
          console.log('Maximum retry attempts reached. Exiting.');
          throw error;
        }
      }
    }
  } else if (initialChoice === '2') {
    await checkAndCreatePath(rootPath);
    return rootPath;
  } else if (initialChoice === '1') {
    let currentPath = '.';
    let selectedPath = '';
    let finalSelection = false;

    while (!finalSelection) {
      const directories = await listDirectories(currentPath);

      const index = await select({
        message: `\nCurrent directory: ${currentPath}\nSelect a directory:`,
        choices: directories.map((dir, idx) => ({
          name: dir,
          value: idx,
        })),
      });

      const directory = directories[index];

      if (directory === '..') {
        currentPath = path.resolve(currentPath, '..');
      } else if (directory === '.') {
        currentPath = path.resolve(currentPath);
      } else {
        currentPath = path.resolve(currentPath, directory);
      }

      const finalize = await confirm({
        message: 'Do you want to finalize this directory selection? (Y/N): ',
      });

      if (finalize) {
        finalSelection = true;
        selectedPath = currentPath;
      }
    }

    return selectedPath;
  }
};

/**
 * Process and update string
 * @param input
 */
export function processAndUpdatePassword(input: string): string {
  const wrappers = ["'", '"', '`'];
  let wrapper = "'";

  for (const w of wrappers) {
    if (!input.includes(w)) {
      wrapper = w;
      break;
    }
  }

  const escapedString = input.replace(new RegExp(`[${wrapper}]`, 'g'), `\\${wrapper}`);
  return `${wrapper}${escapedString}${wrapper}`;
}

/**
 * Capitalize the first letter of a string
 * @param str
 */
export function capitalizeFirstLetter(str: string): string {
  if (!str) return str;
  const [first, ...rest] = str;
  return `${first.toUpperCase()}${rest.join('')}`;
}
