import DOMPurify from "isomorphic-dompurify";

// Sem alias "@/" nem enum/namespace: scripts/testar-sanitizar-svg.mjs importa
// este arquivo direto pelo Node (que só remove os tipos), sem bundler.

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const REFERENCIA_LOCAL = /^#[\w.:-]+$/;
const URL_LOCAL = /^url\(\s*#[\w.:-]+\s*\)$/;
const ESCAPE_CSS = /\\(?:([0-9a-f]{1,6})[ \t\r\n\f]?|([\s\S]))/gi;
const COMENTARIO_CSS = /\/\*[\s\S]*?\*\//g;

type Opcoes = {
  // Mapa que acompanha a largura da tela: garante viewBox e tira width/height
  // fixos, que estouram no celular. Sem viewBox nem medidas, não há mapa.
  responsivo?: boolean;
};

// O navegador decodifica escapes CSS (u\72l( vira url() e ignora maiúsculas;
// a checagem tem de olhar o valor do mesmo jeito.
function normalizarCss(valor: string) {
  return valor
    .replace(ESCAPE_CSS, (_trecho: string, hex: string | undefined, caractere: string | undefined) => {
      if (hex === undefined) return caractere ?? "";
      const codigo = Number.parseInt(hex, 16);
      return codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : "�";
    })
    .replace(COMENTARIO_CSS, "")
    .toLowerCase()
    .trim();
}

function atributoProibido(nome: string, valor: string) {
  if (nome.startsWith("on")) return true;
  if (nome === "href" || nome === "xlink:href") return !REFERENCIA_LOCAL.test(valor.trim());

  const css = normalizarCss(valor);
  return css.includes("url(") && !URL_LOCAL.test(css);
}

function limparAtributos(no: Element) {
  for (const atributo of Array.from(no.attributes)) {
    if (atributoProibido(atributo.name.toLowerCase(), atributo.value)) no.removeAttribute(atributo.name);
  }
}

function tornarResponsivo(raiz: Element) {
  if (!raiz.getAttribute("viewBox")) {
    const largura = Number.parseFloat(raiz.getAttribute("width") ?? "");
    const altura = Number.parseFloat(raiz.getAttribute("height") ?? "");
    if (!(largura > 0 && altura > 0)) return false;
    raiz.setAttribute("viewBox", `0 0 ${largura} ${altura}`);
  }
  raiz.removeAttribute("width");
  raiz.removeAttribute("height");
  raiz.setAttribute("focusable", "false");
  return true;
}

// Mesma regra no servidor (antes de gravar o mapa) e no navegador (logo antes de
// injetar com dangerouslySetInnerHTML). Devolve null se a raiz não for um <svg>
// ou se não sobrar desenho nenhum.
// Ajustes na raiz são feitos no nó, antes de serializar: nunca com
// String.replace sobre o texto limpo, que interpreta $' e $& da substituição e
// devolve atributos que a limpeza tinha tirado.
export function sanitizarSvg(texto: string, { responsivo = false }: Opcoes = {}): string | null {
  if (!texto.trim()) return null;

  DOMPurify.addHook("afterSanitizeAttributes", limparAtributos);
  let corpo: Node;
  try {
    corpo = DOMPurify.sanitize(texto, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ["script", "foreignObject", "style", "use"],
      FORBID_ATTR: ["style"],
      RETURN_DOM: true,
    });
  } finally {
    DOMPurify.removeHook("afterSanitizeAttributes", limparAtributos);
  }

  const elementos = Array.from((corpo as Element).children);
  const raiz = elementos[0];
  if (elementos.length !== 1 || raiz.localName !== "svg" || raiz.namespaceURI !== SVG_NS) return null;
  if (raiz.childElementCount === 0) return null;
  if (responsivo && !tornarResponsivo(raiz)) return null;

  // O arquivo gravado é servido sozinho como image/svg+xml: sem os namespaces
  // declarados, o parser XML do navegador recusa o desenho.
  raiz.setAttribute("xmlns", SVG_NS);
  if (Array.from(raiz.querySelectorAll("*")).some((no) => no.hasAttribute("xlink:href"))) {
    raiz.setAttribute("xmlns:xlink", XLINK_NS);
  }

  return raiz.outerHTML;
}
