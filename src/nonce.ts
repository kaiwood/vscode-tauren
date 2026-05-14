import { randomInt } from 'crypto';

const nonceChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const nonceLength = 32;

export function createNonce(): string {
  let nonce = '';

  for (let index = 0; index < nonceLength; index += 1) {
    nonce += nonceChars[randomInt(nonceChars.length)];
  }

  return nonce;
}
