import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import process from 'node:process';

export class Version {
  private static repoUrl = 'https://github.com/exsat-network/exsat-client';
  private static repoPath = 'exsat-network/exsat-client';
  private static packageJsonPath = path.join(process.cwd(), './package.json');

  // Get the latest version number of the remote warehouse
  static async getLatestVersion(): Promise<string | null> {
    try {
      const response = await axios.get(`https://api.github.com/repos/${this.repoPath}/releases/latest`);
      return response.data.tag_name;
    } catch (error) {
      throw new Error('Failed to fetch latest version:');
    }
  }

  // Get the description of a specific tag
  static async getTagDescription(tag: string): Promise<string | null> {
    try {
      const response = await axios.get(`https://api.github.com/repos/${this.repoPath}/releases/tags/${tag}`);
      return response.data.body || null;
    } catch (error: any) {
      throw new Error(`Failed to fetch description for tag ${tag}: ${error.message}`);
    }
  }

  // Get the current version number of the local package.json
  static async getLocalVersion(): Promise<string | null> {
    try {
      if (!fs.existsSync(this.packageJsonPath)) {
        throw new Error('package.json not found');
      }

      const packageJsonContent = fs.readFileSync(this.packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageJsonContent);
      return packageJson.version || null;
    } catch (error) {
      throw new Error('Failed to fetch local version from package.json:');
    }
  }

  /**
   * Checks for updates by comparing the latest version with the local version.
   * If a newer version is found, it retrieves the description of the new version.
   * @param action Optional parameter for additional actions (not used in this implementation)
   * @returns An object containing the latest version, current local version, and new version description if an update is available
   * @throws Error if unable to determine the versions
   */
  static async checkForUpdates(action?) {
    // Retrieve the latest version and the local version
    const [latestVersion, localVersion] = await Promise.all([this.getLatestVersion(), this.getLocalVersion()]);

    // If unable to retrieve version information, throw an error
    if (!latestVersion || !localVersion) {
      throw new Error('Failed to determine versions');
    }

    // Remove 'v' prefix from the version string if it exists
    const cleanVersion = (version: string) => version.replace(/^v/, '');

    // Cleaned version numbers
    const cleanLatestVersion = cleanVersion(latestVersion);
    const cleanLocalVersion = cleanVersion(localVersion);

    let newVersion: string | boolean = false;
    // Compare version numbers; if the latest version is newer than the local version, get the new version description
    if (this.isNewerVersion(cleanLatestVersion, cleanLocalVersion)) {
      newVersion = await this.getTagDescription(latestVersion);
    }

    // Return version information
    return {
      latest: latestVersion,
      current: localVersion,
      newVersion,
    };
  }

  /**
   * Compare two version numbers to determine if the latest version is newer than the current version
   * @param latest The latest version number
   * @param current The current version number
   * @returns True if the latest version is newer than the current version, otherwise false
   */
  static isNewerVersion(latest: string, current: string): boolean {
    const latestParts = latest.split('.').map(Number);
    const currentParts = current.split('.').map(Number);
    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
      if ((latestParts[i] || 0) > (currentParts[i] || 0)) return true;
      if ((latestParts[i] || 0) < (currentParts[i] || 0)) return false;
    }
    return false;
  }
}
