const nonceChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function createNonce(): string {
  let nonce = '';

  for (let index = 0; index < 32; index += 1) {
    nonce += nonceChars.charAt(Math.floor(Math.random() * nonceChars.length));
  }

  return nonce;
}
