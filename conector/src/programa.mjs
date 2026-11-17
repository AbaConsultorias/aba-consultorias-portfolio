import fs from 'node:fs';
import path from 'node:path';
import { CODIGO_SAIDA, executarCiclo } from './ciclo.mjs';
import { chaveValida, lerConfig } from './config.mjs';
import { criarLog, descreverErro } from './log.mjs';
import { adquirirTrava } from './trava.mjs';

function valorDoArgumento(argv, nome) {
  const indice = argv.indexOf(nome);
  return indice >= 0 ? argv[indice + 1] : undefined;
}

export async function rodar({
  env = process.env,
  argv = [],
  relogio = Date.now,
  fetchImpl = globalThis.fetch,
  limites,
  eco = false,
} = {}) {
  const caminhoConfig = valorDoArgumento(argv, '--config') ?? env.ABA_CONECTOR_CONFIG ?? path.resolve('config.json');
  const lida = lerConfig(caminhoConfig);
  if (!lida.ok) {
    process.stderr.write(`Configuração inválida: ${lida.erros.join('; ')}\n`);
    return CODIGO_SAIDA.config;
  }
  const { config } = lida;

  const chave = env.ABA_CONECTOR_CHAVE;
  if (!chaveValida(chave)) {
    process.stderr.write('A variável ABA_CONECTOR_CHAVE não existe ou não tem o formato de uma chave de servidor.\n');
    return CODIGO_SAIDA.config;
  }

  const log = criarLog({ pasta: config.pastaLogs, relogio, segredos: [chave, config.raiz], eco });
  try {
    fs.mkdirSync(config.pastaEstado, { recursive: true });
  } catch (erro) {
    log.erro(`Não foi possível preparar a pasta de estado (${descreverErro(erro)})`);
    return CODIGO_SAIDA.config;
  }

  const trava = adquirirTrava(path.join(config.pastaEstado, 'ciclo.lock'), relogio);
  if (!trava.ok) {
    log.info('Outra execução do conector está em andamento: saindo sem fazer nada');
    return CODIGO_SAIDA.ok;
  }

  try {
    const resultado = await executarCiclo({ config, chave, log, relogio, fetchImpl, limites });
    return resultado.codigoSaida;
  } catch (erro) {
    log.erro(`Falha inesperada (${descreverErro(erro)})`);
    return CODIGO_SAIDA.falha;
  } finally {
    trava.liberar();
  }
}
