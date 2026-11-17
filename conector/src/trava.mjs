import { randomBytes } from 'node:crypto';
import fs from 'node:fs';

export const VALIDADE_TRAVA_MS = 15 * 60_000;

function pidVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    return erro.code === 'EPERM';
  }
}

function lerBruto(fsImpl, caminho) {
  try {
    return fsImpl.readFileSync(caminho, 'utf8');
  } catch {
    return null;
  }
}

function travaVelha(fsImpl, caminho, bruto, relogio, validadeMs) {
  let dados = null;
  try {
    dados = JSON.parse(bruto);
  } catch {
    dados = null;
  }
  if (!dados || typeof dados.em !== 'number') {
    try {
      return relogio() - fsImpl.statSync(caminho).mtimeMs > validadeMs;
    } catch {
      return true;
    }
  }
  return relogio() - dados.em > validadeMs || !pidVivo(dados.pid);
}

function criarTrava(fsImpl, caminho, relogio, pid) {
  const fd = fsImpl.openSync(caminho, 'wx');
  try {
    fsImpl.writeSync(fd, JSON.stringify({ pid, em: relogio() }));
  } finally {
    fsImpl.closeSync(fd);
  }
  return {
    ok: true,
    liberar() {
      const bruto = lerBruto(fsImpl, caminho);
      if (bruto === null) return;
      try {
        if (JSON.parse(bruto).pid === pid) fsImpl.rmSync(caminho, { force: true });
      } catch {
        // trava de outro processo ou ilegível: não é nossa para apagar
      }
    },
  };
}

function devolverTrava(fsImpl, renomeada, caminho) {
  try {
    fsImpl.linkSync(renomeada, caminho);
  } catch {
    // já existe outra trava no lugar: a que levamos por engano não serve mais a ninguém
  }
  fsImpl.rmSync(renomeada, { force: true });
}

// Comparar e apagar são dois passos: dois processos poderiam tomar a mesma trava velha. O rename
// é atômico, então só um deles leva o arquivo; quem chega depois renomeia a trava NOVA do outro,
// percebe pelo conteúdo e a devolve.
function tomarTravaVelha(fsImpl, caminho, bruto, pid, aleatorio) {
  const renomeada = `${caminho}.${pid}.${aleatorio()}.velha`;
  try {
    fsImpl.renameSync(caminho, renomeada);
  } catch (erro) {
    return erro.code === 'ENOENT' ? 'sumiu' : 'perdeu';
  }
  if (lerBruto(fsImpl, renomeada) !== bruto) {
    devolverTrava(fsImpl, renomeada, caminho);
    return 'perdeu';
  }
  fsImpl.rmSync(renomeada, { force: true });
  return 'tomada';
}

export function adquirirTrava(
  caminho,
  relogio = Date.now,
  {
    pid = process.pid,
    validadeMs = VALIDADE_TRAVA_MS,
    fsImpl = fs,
    aleatorio = () => randomBytes(6).toString('hex'),
  } = {},
) {
  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    try {
      return criarTrava(fsImpl, caminho, relogio, pid);
    } catch (erro) {
      if (erro.code !== 'EEXIST') throw erro;
    }

    const bruto = lerBruto(fsImpl, caminho);
    if (bruto === null) continue;
    if (!travaVelha(fsImpl, caminho, bruto, relogio, validadeMs)) return { ok: false };
    if (lerBruto(fsImpl, caminho) !== bruto) return { ok: false };

    const tomada = tomarTravaVelha(fsImpl, caminho, bruto, pid, aleatorio);
    if (tomada === 'sumiu') continue;
    if (tomada === 'perdeu') return { ok: false };

    try {
      return criarTrava(fsImpl, caminho, relogio, pid);
    } catch (erro) {
      if (erro.code === 'EEXIST') return { ok: false };
      throw erro;
    }
  }
  return { ok: false };
}
