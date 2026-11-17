"use client";

import { useEffect, useRef, useState } from "react";
import "./visualizador.css";

type Props = { documentoId: string };
type Estado = "carregando" | "pronto" | "erro";

const LARGURA_MAXIMA = 1000;
const DENSIDADE_MAXIMA = 2;
const MENSAGEM_DE_ERRO = "Não foi possível abrir este documento agora. Volte e tente de novo.";

// Desenha as páginas do PDF em <canvas>, sem botão de baixar ou imprimir e sem expor a URL. É um freio, não uma
// proteção absoluta: quem tira print da tela, ou captura a resposta da rede, ainda consegue o conteúdo.
export function VisualizadorPdf({ documentoId }: Props) {
  const area = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState<Estado>("carregando");

  useEffect(() => {
    const raiz = area.current;
    if (!raiz) return;
    const controlador = new AbortController();
    let documento: { destroy: () => unknown } | null = null;

    async function desenhar(destino: HTMLDivElement) {
      try {
        const resposta = await fetch(`/api/portal/documentos/${documentoId}/visualizar`, { cache: "no-store", signal: controlador.signal });
        if (!resposta.ok) throw new Error("indisponivel");
        const { url } = (await resposta.json()) as { url: string };

        // O PDF inteiro vem numa requisição GET simples ao R2 (sem Range nem cabeçalho próprio), e o pdf.js recebe os bytes.
        const arquivo = await fetch(url, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: controlador.signal });
        if (!arquivo.ok) throw new Error("indisponivel");
        const bytes = new Uint8Array(await arquivo.arrayBuffer());

        const pdfjs = await import("pdfjs-dist");
        // O worker é empacotado pelo Next e servido do próprio site (/_next/static): cabe no script-src 'self'.
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const tarefa = pdfjs.getDocument({ data: bytes, enableXfa: false });
        // Destruir a tarefa de carregamento libera o documento e o worker.
        documento = tarefa;
        const pdf = await tarefa.promise;
        if (controlador.signal.aborted) return;

        const larguraCss = Math.min(destino.clientWidth || LARGURA_MAXIMA, LARGURA_MAXIMA);
        const densidade = Math.min(window.devicePixelRatio || 1, DENSIDADE_MAXIMA);
        for (let numero = 1; numero <= pdf.numPages; numero += 1) {
          const pagina = await pdf.getPage(numero);
          if (controlador.signal.aborted) return;
          const escala = larguraCss / pagina.getViewport({ scale: 1 }).width;
          const viewport = pagina.getViewport({ scale: escala * densidade });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(viewport.width / densidade)}px`;
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `Página ${numero} de ${pdf.numPages}`);
          destino.appendChild(canvas);
          await pagina.render({ canvas, viewport }).promise;
          if (numero === 1) setEstado("pronto");
        }
        setEstado("pronto");
      } catch {
        if (!controlador.signal.aborted) setEstado("erro");
      }
    }

    void desenhar(raiz);
    return () => {
      controlador.abort();
      raiz.replaceChildren();
      void Promise.resolve(documento?.destroy()).catch(() => undefined);
    };
  }, [documentoId]);

  useEffect(() => {
    // Ctrl/Cmd+S e Ctrl/Cmd+P ficam sem efeito nesta página.
    function bloquear(evento: KeyboardEvent) {
      if ((evento.ctrlKey || evento.metaKey) && ["s", "p"].includes(evento.key.toLowerCase())) evento.preventDefault();
    }
    window.addEventListener("keydown", bloquear);
    return () => window.removeEventListener("keydown", bloquear);
  }, []);

  return (
    <div className="portal-visualizador" onContextMenu={(evento) => evento.preventDefault()} onDragStart={(evento) => evento.preventDefault()}>
      {estado === "carregando" && <p className="portal-visualizador-estado" role="status">Carregando o documento…</p>}
      {estado === "erro" && <p className="portal-visualizador-estado" role="alert">{MENSAGEM_DE_ERRO}</p>}
      <div ref={area} className="portal-visualizador-paginas" />
    </div>
  );
}
