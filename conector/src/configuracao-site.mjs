import { createHash } from 'node:crypto';
import { caminhoBloqueado, listaBloqueio, normalizarCaminhoRelativo } from './caminho.mjs';

export const LIMITE_PDF_BYTES = 104_857_600;
const CODIGO_PASTA = /^[A-Za-z0-9]{1,16}$/;

// Só entra o que muda o destino de um arquivo (empreendimentos, regras, bloqueio e limite), com
// listas ordenadas: campos novos ou ordem diferente no JSON do site não mudam o hash.
export function hashConfiguracao(resposta) {
  const ordenar = (lista) => [...lista].sort();
  const empreendimentos = (Array.isArray(resposta?.empreendimentos) ? resposta.empreendimentos : []).map((emp) => ({
    codigo: String(emp?.codigo_pasta ?? ''),
    regras: ordenar(
      (Array.isArray(emp?.regras) ? emp.regras : []).map((regra) => `${regra?.id ?? ''}|${regra?.caminho_prefixo ?? ''}`),
    ),
  }));
  empreendimentos.sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0));
  const canonico = {
    bloqueio: ordenar((Array.isArray(resposta?.bloqueio) ? resposta.bloqueio : []).map(String)),
    empreendimentos,
    limite_bytes: Number(resposta?.limite_bytes) || 0,
  };
  return createHash('sha256').update(JSON.stringify(canonico)).digest('hex');
}

export function interpretarConfiguracao(resposta) {
  if (!resposta || !Array.isArray(resposta.empreendimentos)) return null;

  const limite = Number(resposta.limite_bytes);
  const limiteBytes = Number.isFinite(limite) && limite > 0 ? Math.min(limite, LIMITE_PDF_BYTES) : LIMITE_PDF_BYTES;
  const bloqueio = listaBloqueio(Array.isArray(resposta.bloqueio) ? resposta.bloqueio : []);

  const empreendimentos = [];
  const problemas = [];
  for (const bruto of resposta.empreendimentos) {
    const codigo = bruto?.codigo_pasta;
    if (typeof codigo !== 'string' || !CODIGO_PASTA.test(codigo)) {
      problemas.push({ codigo: String(codigo ?? '?').slice(0, 16), mensagem: 'Código de pasta inválido na configuração do site' });
      continue;
    }
    const prefixos = [];
    for (const regra of Array.isArray(bruto.regras) ? bruto.regras : []) {
      const normalizado = normalizarCaminhoRelativo(regra?.caminho_prefixo);
      if (!normalizado.ok) {
        problemas.push({ codigo, mensagem: `Regra ignorada: caminho inválido (${normalizado.motivo})` });
        continue;
      }
      if (caminhoBloqueado(normalizado.segmentos, bloqueio)) {
        problemas.push({ codigo, mensagem: `Regra ignorada: a pasta "${normalizado.texto}" está na lista de bloqueio` });
        continue;
      }
      prefixos.push(normalizado.segmentos);
    }
    empreendimentos.push({ codigo, prefixos });
  }
  return { limiteBytes, bloqueio, empreendimentos, problemas };
}
