import * as crypto from 'crypto';

export class RSAUtil {
  /**
   * Encrypt data using public key
   * @param data Data to encrypt
   * @param publicKey Public key
   * @param encoding Output encoding format, default 'base64'
   * @returns Encrypted data
   */
  static encrypt(data: string, publicKey: string, encoding: BufferEncoding = 'base64'): string {
    try {
      const buffer = Buffer.from(data, 'utf8');
      const encrypted = crypto.publicEncrypt(
        {
          key: publicKey,
          padding: crypto.constants.RSA_PKCS1_PADDING,
        },
        buffer
      );
      return encrypted.toString(encoding);
    } catch (error) {
      throw new Error(`Failed to encrypt data: ${(error as any).message}`);
    }
  }

  /**
   * Decrypt data using private key
   * @param encryptedData Encrypted data
   * @param privateKey Private key
   * @param encoding Input encoding format, default 'base64'
   * @returns Decrypted data
   */
  static decrypt(encryptedData: string, privateKey: string, encoding: BufferEncoding = 'base64'): string {
    try {
      const buffer = Buffer.from(encryptedData, encoding);
      const decrypted = crypto.privateDecrypt(
        {
          key: privateKey,
          padding: crypto.constants.RSA_PKCS1_PADDING,
        },
        buffer
      );
      return decrypted.toString('utf8');
    } catch (error) {
      throw new Error(`Failed to decrypt data: ${(error as any).message}`);
    }
  }
}
