import * as fs from 'fs';
import * as path from 'path';
import process from 'node:process';
import { http } from './http';

export class Version {
  private static repoPath = 'exsat-network/exsat-client';
  private static dockerRepoPath = 'exsatnetwork/exsat-client';
  private static packageJsonPath = path.join(process.cwd(), './package.json');

  // Get the latest version number of the remote warehouse
  static async getLatestVersion(): Promise<string | null> {
    try {
      const response = await http.get(`https://api.github.com/repos/${this.repoPath}/tags`);
      return response.data[0].name;
    } catch (error) {
      throw new Error('Failed to fetch latest version:');
    }
  }

  // Get the latest version number of the remote Docker hub
  static async getDockerLatestVersion(): Promise<string | null> {
    try {
      const response = await http.get(
        `https://registry.hub.docker.com/v2/repositories/${this.dockerRepoPath}/tags?page_size=5&page=1&ordering=last_updated`
      );
      const datas = response.data.results;
      for (const data of datas) {
        if (data.name !== 'latest') {
          return data.name;
        }
      }
    } catch (error) {
      throw new Error('Failed to fetch latest version:');
    }
  }

  // Get the description of a specific tag
  static async getTagDescription(tag: string): Promise<string | null> {
    try {
      const response = await http.get(`https://api.github.com/repos/${this.repoPath}/releases/tags/${tag}`);
      return response.data.body || null;
    } catch (error: any) {
      throw new Error(`Failed to fetch description for tag ${tag}: ${error.message}`);
    }
  }

  // Get the current version number of the local package.json
  static async getLocalVersion(): Promise<string | null> {
    if (!fs.existsSync(this.packageJsonPath)) {
      throw new Error('package.json not found');
    }
    try {
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
   * @returns An object containing the latest version, current local version, and new version description if an update is available
   * @throws Error if unable to determine the versions
   */
  static async checkForUpdates() {
    // Retrieve the latest version and the local version
    const [latestVersion, localVersion] = await Promise.all([this.getLatestVersion(), this.getLocalVersion()]);

    // If unable to retrieve version information, throw an error
    if (!latestVersion || !localVersion) {
      throw new Error('Failed to determine versions');
    }

    let newVersion: string | boolean = false;
    // Compare version numbers; if the latest version is newer than the local version, get the new version description
    if (this.isNewerVersion(latestVersion, localVersion)) {
      //newVersion = (await this.getTagDescription(latestVersion)) ?? true;
      newVersion = true;
    }

    // Return version information
    return {
      latest: latestVersion,
      current: localVersion,
      newVersion,
    };
  }

  /**
   * Checks for updates by comparing the latest version with the local version.
   * If a newer version is found, it retrieves the description of the new version.
   * @returns An object containing the latest version, current local version, and new version description if an update is available
   * @throws Error if unable to determine the versions
   */
  static async checkForDockerUpdates() {
    // Retrieve the latest version and the local version
    const [latestVersion, localVersion] = await Promise.all([this.getDockerLatestVersion(), this.getLocalVersion()]);

    // If unable to retrieve version information, throw an error
    if (!latestVersion || !localVersion) {
      throw new Error('Failed to determine versions');
    }

    let newVersion: string | boolean = false;
    // Compare version numbers; if the latest version is newer than the local version, get the new version description
    if (this.isNewerVersion(latestVersion, localVersion)) {
      //newVersion = (await this.getTagDescription(latestVersion)) ?? true;
      newVersion = true;
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
    // Remove 'v' prefix from the version string if it exists
    const cleanVersion = (version: string) => version.replace(/^v/, '');
    // Cleaned version numbers
    const cleanLatestVersion = cleanVersion(latest);
    const cleanCurrentVersion = cleanVersion(current);

    const parseVersion = (version: string) => {
      const [main, pre] = version.split('-');
      const parts = main.split('.').map(Number);
      return { parts, pre };
    };

    const compare = (a: number[], b: number[]) => {
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const diff = (a[i] || 0) - (b[i] || 0);
        if (diff !== 0) return diff;
      }
      return 0;
    };

    const latestParsed = parseVersion(cleanLatestVersion);
    const currentParsed = parseVersion(cleanCurrentVersion);

    const mainComparison = compare(latestParsed.parts, currentParsed.parts);
    if (mainComparison !== 0) return mainComparison > 0;

    const preA = latestParsed.pre || '';
    const preB = currentParsed.pre || '';

    if (!preA && preB) return true; // No pre-release is newer
    if (preA && !preB) return false;

    return preA.localeCompare(preB) > 0;
  }
}
