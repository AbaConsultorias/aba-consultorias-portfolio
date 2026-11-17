import { createHash } from 'node:crypto';

export function sha256Buffer(dados) {
  return createHash('sha256').update(dados).digest('hex');
}
