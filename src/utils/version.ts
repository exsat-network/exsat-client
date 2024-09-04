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
      const response = await axios.get(
        `https://api.github.com/repos/${this.repoPath}/releases/latest`,
      );
      return response.data.tag_name;
    } catch (error) {
      throw new Error('Failed to fetch latest version:');
    }
  }

  // Get the description of a specific tag
  static async getTagDescription(tag: string): Promise<string | null> {
    try {
      const response = await axios.get(
        `https://api.github.com/repos/${this.repoPath}/releases/tags/${tag}`,
      );
      return response.data.body || null;
    } catch (error: any) {
      throw new Error(
        `Failed to fetch description for tag ${tag}: ${error.message}`,
      );
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

  // Check if the code needs to be updated
  static async checkForUpdates(action?) {
    const [latestVersion, localVersion] = await Promise.all([
      this.getLatestVersion(),
      this.getLocalVersion(),
    ]);

    if (!latestVersion || !localVersion) {
      throw new Error('Failed to determine versions');
    }
    let newVersion: string | boolean = false;
    if (latestVersion !== localVersion) {
      newVersion = await this.getTagDescription(latestVersion)
    }
    return {
      latest: latestVersion,
      current: localVersion,
      newVersion,
    };
  }
}
