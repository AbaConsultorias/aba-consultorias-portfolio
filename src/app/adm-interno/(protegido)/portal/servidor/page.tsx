import { notFound } from "next/navigation";
import { ChaveDoServidor } from "@/components/admin/portal/conector/ChaveDoServidor";
import { InterruptorGeral } from "@/components/admin/portal/conector/InterruptorGeral";
import { UsoR2 } from "@/components/admin/portal/conector/UsoR2";
import { MensagemDeErro } from "@/components/admin/comum/campos";
import { estadoDoConector } from "@/app/api/(modules)/adm-interno/portal/conector/service";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";
import { listarOpcoesEmpreendimentos } from "@/lib/portal/comum/opcoes";
import { conectorSilencioso } from "@/lib/portal/conector/alerta";
import { lerLiberacaoAutomaticaGeral, listarEnviosRecentes, nomesPorCodigoDePasta } from "@/lib/portal/conector/consultas";
import { dataHoraSaoPaulo, haQuantoTempo, ROTULO_ESTADO_ENVIO, rotuloDaContagem } from "@/lib/portal/conector/formato";
import { agruparErrosPorEmpreendimento } from "@/lib/portal/conector/resumo";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ServidorPage() {
  const { perfil } = await exigirRegraPagina("painel.servidor");
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();
  const ehAdmin = perfil.papel === "admin";

  const sessao = await createClient();
  // Não há função que traduza código de pasta em nome: só o admin lê a tabela, os demais veem o erro pelo código.
  const [estado, liberacaoGeral, envios, nomesPorCodigo, empreendimentos] = await Promise.all([
    estadoDoConector(sessao).catch(() => null),
    lerLiberacaoAutomaticaGeral(sessao).catch(() => null),
    listarEnviosRecentes(sessao).catch(() => null),
    ehAdmin ? nomesPorCodigoDePasta(sessao).catch(() => null) : null,
    listarOpcoesEmpreendimentos().catch(() => null),
  ]);
  if (!estado) return <ErroDeCarga />;

  const agora = new Date();
  const silencioso = estado.ativo && conectorSilencioso(estado, agora);
  const errosPorEmpreendimento = estado.ativo && estado.ultimoCiclo
    ? agruparErrosPorEmpreendimento(estado.ultimoCiclo.erros, nomesPorCodigo ?? new Map())
    : [];
  const nomesEmpreendimento = new Map((empreendimentos ?? []).map((item) => [item.id, item.nome]));

  return (
    <div className="portal-entrada flex flex-col gap-6">
      <header>
        <p className="portal-sobretitulo">Gestão do portal</p>
        <h1 className="portal-titulo">Servidor</h1>
        <p className="portal-descricao">O programa do servidor da empresa envia os PDFs dos empreendimentos para o portal. Aqui você acompanha o envio e controla a chave de acesso.</p>
      </header>

      <Secao titulo="Situação do conector">
        {estado.ativo ? (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Dado rotulo="Chave" valor={`${estado.nome}, emitida em ${dataHoraSaoPaulo(estado.criadoEm)}`} />
            <Dado
              rotulo="Último contato"
              valor={estado.ultimoContatoEm ? `${dataHoraSaoPaulo(estado.ultimoContatoEm)} (${haQuantoTempo(estado.ultimoContatoEm, agora)})` : "Ainda não entrou em contato"}
            />
            <Dado rotulo="Versão do programa" valor={estado.versao ?? "—"} />
          </dl>
        ) : (
          <p className="text-sm">Nenhuma chave ativa. O servidor da empresa não está enviando documentos.</p>
        )}
        {silencioso && (
          <p role="alert" className="text-sm text-destructive">
            O servidor está sem contato há mais de 24 horas. Confira se o computador está ligado e se o programa está agendado.
          </p>
        )}
      </Secao>

      <Secao titulo="Chave do servidor">
        <ChaveDoServidor adminPath={adminPath} ativo={estado.ativo} ehAdmin={ehAdmin} />
      </Secao>

      <Secao titulo="Liberação automática">
        {liberacaoGeral === null
          ? <MensagemDeErro>Não foi possível carregar este interruptor. Atualize a página.</MensagemDeErro>
          : <InterruptorGeral adminPath={adminPath} ligado={liberacaoGeral} ehAdmin={ehAdmin} />}
      </Secao>

      <Secao titulo="Último ciclo">
        {!estado.ativo || !estado.ultimoCiclo ? (
          <p className="text-sm text-muted-foreground">O servidor ainda não informou nenhum ciclo.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {[estado.ultimoCiclo.inicio && `Início ${dataHoraSaoPaulo(estado.ultimoCiclo.inicio)}`, estado.ultimoCiclo.fim && `fim ${dataHoraSaoPaulo(estado.ultimoCiclo.fim)}`].filter(Boolean).join(" · ")}
            </p>
            {Object.keys(estado.ultimoCiclo.contagens).length > 0 && (
              <dl className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
                {Object.entries(estado.ultimoCiclo.contagens).map(([nome, total]) => (
                  <div key={nome} className="min-w-0 rounded-lg border p-3">
                    <dt className="break-words text-xs text-muted-foreground">{rotuloDaContagem(nome)}</dt>
                    <dd className="text-xl font-semibold">{total}</dd>
                  </div>
                ))}
              </dl>
            )}
            {errosPorEmpreendimento.length === 0 ? (
              <p className="text-sm">Nenhum erro no último ciclo.</p>
            ) : (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-medium">
                  Erros{estado.ultimoCiclo.totalErros > estado.ultimoCiclo.erros.length ? ` (mostrando ${estado.ultimoCiclo.erros.length} de ${estado.ultimoCiclo.totalErros})` : ""}
                </h3>
                <ul className="flex flex-col gap-3">
                  {errosPorEmpreendimento.map((grupo) => (
                    <li key={grupo.chave} className="min-w-0 rounded-lg border border-destructive/40 p-3">
                      <p className="break-words text-sm font-medium">
                        {grupo.codigoPasta === null ? "Erro geral" : `${grupo.nome ?? "Empreendimento não identificado"} (pasta ${grupo.codigoPasta})`}
                      </p>
                      <ul className="mt-1 list-disc pl-5 text-sm">
                        {grupo.mensagens.map((mensagem, indice) => <li key={indice} className="break-words">{mensagem}</li>)}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Secao>

      <Secao titulo="Armazenamento (R2)">
        <UsoR2 adminPath={adminPath} />
      </Secao>

      <Secao titulo="Últimos envios">
        {envios === null ? (
          <MensagemDeErro>Não foi possível carregar os envios. Atualize a página.</MensagemDeErro>
        ) : envios.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum envio registrado ainda.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {envios.map((envio) => (
              <li key={envio.id} className="min-w-0 rounded-lg border p-3 text-sm">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="rounded-full border px-2 py-0.5 text-xs">{ROTULO_ESTADO_ENVIO[envio.estado] ?? envio.estado}</span>
                  <span className="text-muted-foreground">{dataHoraSaoPaulo(envio.em)}</span>
                  <span className="min-w-0 break-words text-muted-foreground">{nomesEmpreendimento.get(envio.empreendimentoId) ?? ""}</span>
                </p>
                <p className="mt-1 break-all">{envio.caminho}</p>
                {envio.erro && <p className="mt-1 break-words text-destructive">{envio.erro}</p>}
              </li>
            ))}
          </ul>
        )}
      </Secao>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="text-lg font-medium">{titulo}</h2>
      {children}
    </section>
  );
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="break-words font-medium">{valor}</dd>
    </div>
  );
}

function ErroDeCarga() {
  return (
    <section className="rounded-xl border p-6">
      <h1 className="text-xl font-semibold">Servidor indisponível</h1>
      <MensagemDeErro>Não foi possível carregar o estado do servidor. Atualize a página para tentar novamente.</MensagemDeErro>
    </section>
  );
}
