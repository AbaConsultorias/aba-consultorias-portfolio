import { AREAS, MODELOS, PERMISSOES, PREREQUISITOS, ehPermissao, type Permissao } from "./permissoes";

export type Selecao = ReadonlySet<Permissao>;

function comTodosOsPrerequisitos(selecao: Set<Permissao>, permissao: Permissao): void {
  if (selecao.has(permissao)) return;
  selecao.add(permissao);
  for (const prerequisito of PREREQUISITOS[permissao] ?? []) comTodosOsPrerequisitos(selecao, prerequisito);
}

export function selecaoDe(lista: readonly string[]): Selecao {
  return new Set(lista.filter(ehPermissao));
}

export function marcar(selecao: Selecao, permissao: Permissao): Selecao {
  const resultado = new Set(selecao);
  comTodosOsPrerequisitos(resultado, permissao);
  return resultado;
}

// Quem depende de uma permissão removida também sai, até não sobrar nenhuma órfã.
export function desmarcar(selecao: Selecao, permissao: Permissao): Selecao {
  const resultado = new Set(selecao);
  resultado.delete(permissao);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const atual of resultado) {
      if ((PREREQUISITOS[atual] ?? []).some((prerequisito) => !resultado.has(prerequisito))) {
        resultado.delete(atual);
        mudou = true;
      }
    }
  }
  return resultado;
}

export function alternar(selecao: Selecao, permissao: Permissao): Selecao {
  return selecao.has(permissao) ? desmarcar(selecao, permissao) : marcar(selecao, permissao);
}

function permissoesDaArea(areaId: string): readonly Permissao[] {
  return AREAS.find((area) => area.id === areaId)?.permissoes.map((item) => item.permissao) ?? [];
}

export function areaCompleta(selecao: Selecao, areaId: string): boolean {
  const permissoes = permissoesDaArea(areaId);
  return permissoes.length > 0 && permissoes.every((permissao) => selecao.has(permissao));
}

export function liberarArea(selecao: Selecao, areaId: string): Selecao {
  const resultado = new Set(selecao);
  for (const permissao of permissoesDaArea(areaId)) comTodosOsPrerequisitos(resultado, permissao);
  return resultado;
}

export function limparArea(selecao: Selecao, areaId: string): Selecao {
  let resultado = selecao;
  for (const permissao of permissoesDaArea(areaId)) resultado = desmarcar(resultado, permissao);
  return resultado;
}

// O modelo soma às caixas já marcadas, para combinar modelos; quem quiser menos desmarca.
export function aplicarModelo(selecao: Selecao, modeloId: string): Selecao {
  const modelo = MODELOS.find((item) => item.id === modeloId);
  if (!modelo) return selecao;
  const resultado = new Set(selecao);
  for (const permissao of modelo.permissoes) comTodosOsPrerequisitos(resultado, permissao);
  return resultado;
}

export function paraLista(selecao: Selecao): Permissao[] {
  return PERMISSOES.filter((permissao) => selecao.has(permissao));
}

export function mesmaSelecao(a: Selecao, b: Selecao): boolean {
  return a.size === b.size && [...a].every((permissao) => b.has(permissao));
}
