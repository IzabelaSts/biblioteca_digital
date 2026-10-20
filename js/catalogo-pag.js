// Usado em index.html (áreas) e catalogo.html (lista com busca e filtro)
const $ = (id) => document.getElementById(id);
function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
}
const livros = typeof CATALOGO_LIVROS !== "undefined" ? Object.values(CATALOGO_LIVROS) : [];
const areas = [...new Set(livros.map((l) => l.area))].sort();

const hora = new Date().getHours();
if ($("saudacao")) {
  $("saudacao").textContent = (hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite") + "! Bem-vindo à Biblioteca Digital";
}

if ($("areas-grid")) {
  areas.forEach((a) => {
    const n = livros.filter((l) => l.area === a);
    const c = el("a", "card area-card");
    c.href = "catalogo.html?area=" + encodeURIComponent(a);
    c.append(el("span", "area-ico", n[0].capa || "📚"), el("strong", "", a),
      el("small", "mut", `${n.length} ${n.length === 1 ? "livro" : "livros"}`));
    $("areas-grid").append(c);
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

    $("grade-catalogo").replaceChildren(...lista.map((l) => {
      const c = el("article", "card livro-card");
      const livre = !l.restricao;
      c.append(
        el("span", "ico", l.capa || "📖"),
        el("h3", "", l.titulo),
        el("span", "mut", l.autor),
        el("span", "tag", `${l.categoria} · ${l.area}`),
        el("p", "mut", l.sinopse)
      );
      const rodape = el("div", "rodape");
      rodape.append(el("span", "badge " + (livre ? "ok" : "nok"), livre ? "Disponível" : "Consulta local"),
        el("span", "mut", livre ? `Prazo: ${l.prazoDias} dias` : "Sem empréstimo"));
      c.append(rodape);
      return c;
    }));
    $("vazio").classList.toggle("hidden", lista.length > 0);
  }
  $("busca").addEventListener("input", (e) => { termo = e.target.value; desenhar(); });
  desenhar();
}