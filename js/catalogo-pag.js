// Usado em index.html (destaques, áreas, pilha) e catalogo.html (busca + filtro)
const $ = (id) => document.getElementById(id);
function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
}
const livros = typeof CATALOGO_LIVROS !== "undefined" ? Object.values(CATALOGO_LIVROS) : [];
const areas = [...new Set(livros.map((l) => l.area))].sort();

function cores(el_, titulo) {
  let h = 0;
  for (const c of titulo) h = (h * 31 + c.charCodeAt(0)) % 360;
  el_.style.setProperty("--c1", `hsl(${h} 38% 22%)`);
  el_.style.setProperty("--c2", `hsl(${(h + 28) % 360} 42% 38%)`);
}
function capaCss(l) {
  const c = el("div", "capa-livro");
  cores(c, l.titulo);
  c.append(el("span", "capa-area", l.area), el("strong", "capa-titulo", l.titulo), el("span", "capa-autor", l.autor));
  return c;
}
// Usa a foto (campo "imagem" do catalog.js); se não existir ou falhar, usa a capa desenhada
function capa(l) {
  if (!l.imagem) return capaCss(l);
  const c = el("div", "capa-livro foto");
  const img = el("img");
  img.src = l.imagem;
  img.alt = "Capa de " + l.titulo;
  img.loading = "lazy";
  img.onerror = () => c.replaceWith(capaCss(l));
  c.append(img);
  return c;
}
function cartao(l) {
  const livre = !l.restricao;
  const c = el("article", "livro-card");
  c.append(capa(l), el("h3", "", l.titulo), el("span", "mut", l.autor),
    el("span", "tag", l.categoria), el("p", "sin", l.sinopse));
  const b = el("span", "badge " + (livre ? "ok" : "nok"), livre ? `Disponível · ${l.prazoDias} dias` : "Consulta local");
  b.style.justifySelf = "start";
  c.append(b);
  return c;
}

const hora = new Date().getHours();
if ($("saudacao")) $("saudacao").textContent = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";

if ($("pilha")) {
  livros.slice(0, 5).forEach((l) => {
    const s = el("div", "lombada");
    cores(s, l.titulo);
    s.append(el("span", "", l.titulo), el("small", "", l.autor));
    $("pilha").append(s);
  });
}
if ($("destaques")) livros.slice(0, 4).forEach((l) => $("destaques").append(cartao(l)));
if ($("areas-grid")) {
  areas.forEach((a) => {
    const n = livros.filter((l) => l.area === a).length;
    const p = el("a", "area-pill", a);
    p.href = "catalogo.html?area=" + encodeURIComponent(a);
    p.append(el("small", "", String(n)));
    $("areas-grid").append(p);
  });
}

if ($("grade-catalogo")) {
  let area = new URLSearchParams(location.search).get("area") || "Todas";
  let termo = "";
  const norm = (t) => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  function desenhar() {
    $("filtros").replaceChildren(...["Todas", ...areas].map((a) => {
      const b = el("button", "chip" + (a === area ? " ativo" : ""), a);
      b.type = "button";
      b.onclick = () => { area = a; desenhar(); };
      return b;
    }));
    const lista = livros.filter((l) =>
      (area === "Todas" || l.area === area) && norm(l.titulo + " " + l.autor).includes(norm(termo)));
    $("grade-catalogo").replaceChildren(...lista.map(cartao));
    $("vazio").classList.toggle("hidden", lista.length > 0);
  }
  $("busca").addEventListener("input", (e) => { termo = e.target.value; desenhar(); });
  desenhar();
}