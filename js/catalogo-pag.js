document.addEventListener("DOMContentLoaded", () => {
  const campoPesquisa = document.getElementById("pesquisa-livros");
  const filtroCategoria = document.getElementById("filtro-categoria");
  const listaLivros = document.getElementById("lista-livros");
  const quantidadeLivros = document.getElementById("quantidade-livros");
  const mensagemVazia = document.getElementById("mensagem-vazia");

  if (!listaLivros || typeof CATALOGO_LIVROS === "undefined") {
    if (listaLivros) listaLivros.textContent = "Não foi possível carregar o catálogo.";
    return;
  }

  const livros = Object.entries(CATALOGO_LIVROS).map(([id, livro]) => ({ id, ...livro }));
  const categorias = [...new Set(livros.map((livro) => livro.categoria))].sort((a, b) => a.localeCompare(b, "pt-BR"));

  categorias.forEach((categoria) => {
    const opcao = document.createElement("option");
    opcao.value = categoria;
    opcao.textContent = categoria;
    filtroCategoria?.appendChild(opcao);
  });

  function criarCard(livro) {
    const card = document.createElement("article");
    card.className = "catalog-book-card";

    card.innerHTML = `
      <div class="catalog-book-cover" aria-hidden="true">${livro.capa || "📖"}</div>
      <div class="catalog-book-content">
        <span class="category-pill">${livro.categoria}</span>
        <h3>${livro.titulo}</h3>
        <p class="catalog-author">${livro.autor}</p>
        <p class="catalog-synopsis">${livro.sinopse}</p>
        <div class="catalog-book-footer">
          <span>${livro.prazoDias} dias de empréstimo</span>
          <a href="index.html" class="text-link">Emprestar →</a>
        </div>
      </div>
    `;
    return card;
  }

  function renderizar() {
    const termo = (campoPesquisa?.value || "").trim().toLocaleLowerCase("pt-BR");
    const categoriaSelecionada = filtroCategoria?.value || "";
    const filtrados = livros.filter((livro) => {
      const correspondeTexto = `${livro.titulo} ${livro.autor}`.toLocaleLowerCase("pt-BR").includes(termo);
      const correspondeCategoria = !categoriaSelecionada || livro.categoria === categoriaSelecionada;
      return correspondeTexto && correspondeCategoria;
    });

    listaLivros.replaceChildren(...filtrados.map(criarCard));
    if (quantidadeLivros) {
      quantidadeLivros.textContent = `${filtrados.length} ${filtrados.length === 1 ? "livro" : "livros"}`;
    }
    mensagemVazia?.classList.toggle("hidden", filtrados.length !== 0);
  }

  campoPesquisa?.addEventListener("input", renderizar);
  filtroCategoria?.addEventListener("change", renderizar);
  renderizar();
});