import "server-only";
import { listar } from "@/lib/r2/cliente";
import { somarBalde, type SomaDoBalde } from "./uso";

const VALIDADE_MS = 60 * 60 * 1000;

export type UsoDoBalde = SomaDoBalde & { calculadoEm: string };

// Cache por instância do servidor: listar o balde inteiro custa várias chamadas ao R2, e o número só serve de alerta.
// Chamadas simultâneas durante o cálculo dividem a mesma listagem.
let cache: { valor: UsoDoBalde; expiraEm: number } | null = null;
let emAndamento: Promise<UsoDoBalde> | null = null;

export async function obterUsoDoBalde(): Promise<UsoDoBalde> {
  if (cache && cache.expiraEm > Date.now()) return cache.valor;
  emAndamento ??= somarBalde((continuacao) => listar(undefined, continuacao))
    .then((soma) => {
      const valor: UsoDoBalde = { ...soma, calculadoEm: new Date().toISOString() };
      cache = { valor, expiraEm: Date.now() + VALIDADE_MS };
      return valor;
    })
    .finally(() => {
      emAndamento = null;
    });
  return emAndamento;
}
