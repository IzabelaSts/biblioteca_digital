/* =====================================================================
   BIBLIOTECA DIGITAL — Reconhecimento e Empréstimo de Livros
   Arquivo: js/app.js
   ===================================================================== */

/* ------------------------------ CONFIGURAÇÃO ------------------------------ */

// Link do modelo exportado do Teachable Machine
const URL_MODELO = "https://teachablemachine.withgoogle.com/models/8_uI-T1lu/";

// Confiança mínima necessária para considerar uma leitura válida
const LIMIAR_RECONHECIMENTO = 0.85;

// Diferença mínima necessária entre a 1ª e a 2ª maior probabilidade (evita indecisão)
const MARGEM_INDECISAO = 0.30;

// Quantos quadros seguidos o MESMO livro precisa aparecer continuamente para confirmar
const QUADROS_PARA_CONFIRMAR = 5;

// Quantos quadros seguidos de erro são necessários para exibir "Livro não encontrado" (estabiliza a tela)
const QUADROS_PARA_ERRO = 10;

// Espelhar a imagem da webcam
const ESPELHAR_IMAGEM = false;

// Modo de depuração (true para exibir probabilidades na tela)
const MODO_DEPURACAO = false;

const LIMITE_VOLUMES = 10;
const TEMPO_LIMITE_MODELO_MS = 30000;

/* --------------------------------- ESTADO --------------------------------- */

let model = null;
let webcam = null;
let placeholderOriginal = null;
let cameraAtiva = false;
let cameraEmInicializacao = false;
let atendimentoFinalizado = false;
let ultimoLivroLido = null;
let historicoSessao = [];
let temporizadorRelogio = null;
let animFrameID = null;
let sessaoID = null;

// Contadores de estabilização
let candidato = null;
let contagemCandidato = 0;
let contagemErro = 0;

// Trava temporária após registrar um empréstimo
let pausaDetecao = false;

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", iniciarAplicacao);

function iniciarAplicacao() {
  atualizarRelogio();
  temporizadorRelogio = window.setInterval(atualizarRelogio, 1000);
  atualizarInterfaceSessao();
  atualizarHistoricoDOM();
  configurarBotaoCamera();
  mostrarBoasVindas();

  // Escutadores para finalizar / revisar atendimento
  $("btn-finalizar")?.addEventListener("click", solicitarRevisaoOuFinalizar);
  $("btn-fechar-revisao")?.addEventListener("click", fecharRevisaoModal);
  $("btn-voltar-revisao")?.addEventListener("click", fecharRevisaoModal);
  $("btn-confirmar-emprestimo")?.addEventListener("click", emitirComprovanteFinal);

  // Escutadores do comprovante final (atribuição direta para evitar falhas de clique)
  const btnFecharModal = $("btn-fechar-modal");
  if (btnFecharModal) {
    btnFecharModal.onclick = fecharModal;
  }

  $("btn-nova-sessao")?.addEventListener("click", fecharModal);
  $("btn-imprimir")?.addEventListener("click", imprimirComprovante);
}

/* ------------------------- RELÓGIO E BOAS-VINDAS -------------------------- */

function atualizarRelogio() {
  const agora = new Date();
  if ($("relogio")) {
    $("relogio").textContent = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  if ($("data-atual")) {
    $("data-atual").textContent = agora.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  }
}

function saudacao() {
  const hora = new Date().getHours();
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

function mostrarBoasVindas() {
  const nome = localStorage.getItem('usuario_nome');
  const cumprimento = saudacao();

  if ($("mensagem-boas-vindas")) {
    $("mensagem-boas-vindas").textContent = nome
      ? `${cumprimento}, ${nome}! Bem-vindo à Biblioteca Digital.`
      : `${cumprimento}! Bem-vindo à Biblioteca Digital.`;
  }

  if ($("status-leitura")) {
    $("status-leitura").textContent = "Ative a câmera e aproxime a capa de um livro.";
  }
}

/* ------------------------------ INDICADORES ------------------------------- */

function definirEstadoSistema(estado, mensagem) {
  const indicador = document.querySelector(".status-dot");
  if (indicador) {
    indicador.classList.remove("active", "error");
    if (estado === "ativo") indicador.classList.add("active");
    else if (estado === "erro") indicador.classList.add("error");
  }
  if ($("estado-sistema")) $("estado-sistema").textContent = mensagem;
}

function definirEstadoIA(estado, mensagem) {
  const badge = $("ai-status");
  if (!badge) return;
  badge.textContent = mensagem;
  badge.classList.remove("status-waiting", "status-ready", "status-error");
  if (estado === "pronto") badge.classList.add("status-ready");
  else if (estado === "erro") badge.classList.add("status-error");
  else badge.classList.add("status-waiting");
}

/* --------------------------------- CÂMERA --------------------------------- */

function configurarBotaoCamera() {
  $("btn-camera")?.addEventListener("click", async () => {
    if (cameraAtiva) {
      pararCamera();
      return;
    }

    const modalComprovanteAberto = !$("modal-comprovante")?.classList.contains("hidden");
    const modalRevisaoAberto = !$("modal-revisao")?.classList.contains("hidden");
    const modalAberto = modalComprovanteAberto || modalRevisaoAberto;

    if (!modalAberto) {
      atendimentoFinalizado = false;
    }

    await iniciarReconhecimento();
  });
}

async function carregarModelo() {
  if (model) return model;

  if (typeof tmImage === "undefined") {
    throw new Error("As bibliotecas do TensorFlow e do Teachable Machine não estão carregadas no HTML.");
  }

  const urlFinal = URL_MODELO.endsWith("/") ? URL_MODELO : URL_MODELO + "/";
  const carregamento = tmImage.load(urlFinal + "model.json", urlFinal + "metadata.json");
  const limite = new Promise((_, rejeitar) =>
    setTimeout(
      () => rejeitar(new Error("Tempo esgotado ao carregar o modelo. Verifique a internet e o link do modelo.")),
      TEMPO_LIMITE_MODELO_MS
    )
  );

  model = await Promise.race([carregamento, limite]);
  return model;
}

async function iniciarReconhecimento() {
  if (cameraEmInicializacao || cameraAtiva || atendimentoFinalizado) return;
  cameraEmInicializacao = true;

  if ($("btn-camera")) $("btn-camera").disabled = true;
  if ($("status-leitura")) $("status-leitura").textContent = "Solicitando acesso à câmera...";
  if ($("texto-scanner")) $("texto-scanner").textContent = "Solicitando acesso à câmera...";
  definirEstadoSistema("aguardar", "Preparando sistema");
  definirEstadoIA("aguardar", "Carregando");

  try {
    if (webcam) {
      try { await webcam.stop(); } catch (e) {}
      webcam = null;
    }

    await carregarModelo();

    const flip = ESPELHAR_IMAGEM;
    webcam = new tmImage.Webcam(400, 300, flip);

    await webcam.setup({ facingMode: "environment" });
    await webcam.play();

    const container = $("webcam-container");
    if (container) {
      const placeholder = $("camera-placeholder");
      if (placeholder) placeholderOriginal = placeholder;
      container.replaceChildren(webcam.canvas);
    }

    cameraAtiva = true;
    pausaDetecao = false;
    reiniciarConfirmacao();

    if ($("btn-camera")) {
      $("btn-camera").textContent = "Desativar câmera";
      $("btn-camera").disabled = false;
    }
    if ($("texto-scanner")) $("texto-scanner").textContent = "Câmera ativa — aproxime a capa do livro";
    if ($("status-leitura")) $("status-leitura").textContent = "Aproxime a capa do livro para o reconhecimento.";

    document.querySelector(".scan-indicator")?.classList.add("is-active");
    definirEstadoSistema("ativo", "Sistema ativo");
    definirEstadoIA("pronto", "IA Pronta");

    animFrameID = window.requestAnimationFrame(loopReconhecimento);

  } catch (error) {
    console.error("Erro ao iniciar a câmera/modelo:", error);
    pararCamera();
    
    definirEstadoSistema("erro", "Erro de câmera");
    definirEstadoIA("erro", "Erro");
    if ($("status-leitura")) $("status-leitura").textContent = traduzirErroCamera(error);
    if ($("texto-scanner")) $("texto-scanner").textContent = "Não foi possível iniciar o reconhecimento.";
  } finally {
    cameraEmInicializacao = false;
    if ($("btn-camera")) $("btn-camera").disabled = atendimentoFinalizado;
  }
}

function traduzirErroCamera(error) {
  const nome = error?.name;
  if (nome === "NotAllowedError" || nome === "PermissionDeniedError") {
    return "Permissão negada! Permita o acesso à câmera nas configurações do navegador.";
  }
  if (nome === "NotFoundError" || nome === "DevicesNotFoundError") {
    return "Nenhuma câmera encontrada no dispositivo.";
  }
  if (nome === "NotReadableError" || nome === "TrackStartError") {
    return "A câmera está em uso por outro aplicativo. Feche-o e tente novamente.";
  }
  return error?.message || "Erro ao conectar com a câmera.";
}

/* ----------------------------- RECONHECIMENTO ----------------------------- */

function reiniciarConfirmacao() {
  candidato = null;
  contagemCandidato = 0;
}

async function loopReconhecimento() {
  if (!cameraAtiva || !webcam || !model) return;

  webcam.update();
  await preverLivro();

  if (cameraAtiva) {
    animFrameID = window.requestAnimationFrame(loopReconhecimento);
  }
}

async function preverLivro() {
  if (pausaDetecao || !cameraAtiva || !webcam || !model) return;

  const previsoes = await model.predict(webcam.canvas);
  if (!previsoes?.length || !cameraAtiva) return;

  const ordenadas = [...previsoes].sort((a, b) => b.probability - a.probability);
  const melhor = ordenadas[0];
  const segundoMelhor = ordenadas[1];
  const idLivro = melhor.className;
  const porcentagem = Math.round(melhor.probability * 100);

  if ($("status-leitura")) {
    $("status-leitura").textContent = MODO_DEPURACAO
      ? ordenadas.slice(0, 3).map((p) => `${p.className} (${Math.round(p.probability * 100)}%)`).join(" | ")
      : `Lendo: '${idLivro}' (${porcentagem}%).`;
  }

  // Verificação de leitura inválida ou fora do catálogo
  const leituraInvalida = 
    melhor.probability < LIMIAR_RECONHECIMENTO ||
    (segundoMelhor && (melhor.probability - segundoMelhor.probability < MARGEM_INDECISAO)) ||
    !localizarNoCatalogo(idLivro);

  if (leituraInvalida) {
    reiniciarConfirmacao();
    contagemErro++;

    // Só altera o cartão para erro se a falha persistir por vários quadros seguidos
    if (contagemErro >= QUADROS_PARA_ERRO) {
      if ($("texto-scanner")) $("texto-scanner").textContent = "Livro não cadastrado";
      mostrarErroLivro("Esta capa não pertence a nenhum livro cadastrado no catálogo.");
    } else if ($("texto-scanner")) {
      $("texto-scanner").textContent = "Ajustando leitura...";
    }
    return;
  }

  // Se a leitura for válida, reseta o contador de erros acumulados
  contagemErro = 0;

  // Validação de quadros consecutivos para confirmar o livro
  if (idLivro === candidato) {
    contagemCandidato++;
  } else {
    candidato = idLivro;
    contagemCandidato = 1;
  }

  if (contagemCandidato < QUADROS_PARA_CONFIRMAR) {
    if ($("texto-scanner")) $("texto-scanner").textContent = `Confirmando... (${contagemCandidato}/${QUADROS_PARA_CONFIRMAR})`;
    return;
  }

  // Se o livro já foi lido recentemente
  if (idLivro === ultimoLivroLido) {
    if ($("texto-scanner")) $("texto-scanner").textContent = "Livro já lido — mostre o próximo livro";
    return;
  }

  // Sucesso: registra o empréstimo
  if ($("texto-scanner")) $("texto-scanner").textContent = "Livro reconhecido!";
  ultimoLivroLido = idLivro;
  processarEmprestimo(idLivro);
}

/* -------------------------------- CATÁLOGO -------------------------------- */

function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function catalogoDisponivel() {
  return typeof CATALOGO_LIVROS !== "undefined" && CATALOGO_LIVROS ? CATALOGO_LIVROS : null;
}

function localizarNoCatalogo(idLivro) {
  const catalogo = catalogoDisponivel();
  if (!catalogo) return null;
  if (catalogo[idLivro]) return { id: idLivro, livro: catalogo[idLivro] };

  const alvo = normalizar(idLivro);
  const chave = Object.keys(catalogo).find((k) => normalizar(k) === alvo);
  return chave ? { id: chave, livro: catalogo[chave] } : null;
}

function recomendarMesmaArea(idAtual, livroAtual) {
  const catalogo = catalogoDisponivel();
  if (!catalogo) return [];
  return Object.entries(catalogo)
    .filter(([id, l]) => id !== idAtual && l.area === livroAtual.area && !l.restricao)
    .filter(([id]) => !historicoSessao.some((h) => h.id === id))
    .slice(0, 2)
    .map(([, l]) => l.titulo);
}

/* -------------------------------- EMPRÉSTIMO ------------------------------- */

function processarEmprestimo(idReconhecido) {
  if (atendimentoFinalizado || pausaDetecao) return;

  const encontrado = localizarNoCatalogo(idReconhecido);

  if (!encontrado) {
    mostrarErroLivro(`Classe '${idReconhecido}' reconhecida, mas não cadastrada no catálogo.`);
    return;
  }

  const { id, livro } = encontrado;
  mostrarDetalhesLivro(id, livro);

  // Ativa a pausa de 3 segundos para estabilizar a exibição
  pausaDetecao = true;
  setTimeout(() => {
    pausaDetecao = false;
  }, 3000);

  if (livro.restricao) {
    definirEstadoEmprestimo(`Consulta local apenas. "${livro.titulo}" indisponível para empréstimo.`, "error");
    return;
  }

  if (historicoSessao.some((item) => item.id === id)) {
    definirEstadoEmprestimo("Este livro já foi adicionado à estante nesta sessão.", "success");
    return;
  }

  if (historicoSessao.length >= LIMITE_VOLUMES) {
    definirEstadoEmprestimo(`Limite de ${LIMITE_VOLUMES} volumes atingido.`, "error");
    return;
  }

  const dataDevolucao = calcularDevolucao(livro.prazoDias);
  historicoSessao.push({
    id,
    ...livro,
    dataEmprestimo: new Date(),
    dataDevolucao
  });

  definirEstadoEmprestimo(
    `Empréstimo registrado! Devolução até ${formatarData(dataDevolucao)} (${livro.prazoDias} dias). Mostre o próximo livro.`,
    "success"
  );

  atualizarHistoricoDOM();
  mostrarRecomendacoes(id, livro);

  if (navigator.vibrate) navigator.vibrate(200);
}

function definirCapa(elem, livro) {
  if (!elem) return;
  elem.replaceChildren();
  if (livro.imagem) {
    const img = document.createElement("img");
    img.src = livro.imagem;
    img.alt = `Capa de ${livro.titulo}`;
    img.onerror = () => elem.replaceChildren(document.createTextNode(livro.capa || "📖"));
    elem.appendChild(img);
  } else {
    elem.textContent = livro.capa || "📖";
  }
}

function mostrarDetalhesLivro(id, livro) {
  $("card-livro")?.classList.remove("hidden");
  if ($("livro-area")) $("livro-area").textContent = `Área: ${livro.area}`;
  if ($("livro-categoria")) $("livro-categoria").textContent = livro.categoria;
  if ($("livro-titulo")) $("livro-titulo").textContent = livro.titulo;
  if ($("livro-autor")) $("livro-autor").textContent = livro.autor;
  if ($("livro-sinopse")) $("livro-sinopse").textContent = livro.sinopse;
  definirCapa($("livro-capa"), livro);
  limparRecomendacoes();
}

function obterElementoRecomendacoes() {
  let el = $("livro-recomendacoes");
  if (!el) {
    const card = $("card-livro");
    if (!card) return null;
    el = document.createElement("p");
    el.id = "livro-recomendacoes";
    el.className = "livro-recomendacoes";
    el.style.marginTop = "10px";
    el.style.fontSize = "0.9rem";
    card.appendChild(el);
  }
  return el;
}

function limparRecomendacoes() {
  const el = $("livro-recomendacoes");
  if (el) el.textContent = "";
}

function mostrarRecomendacoes(id, livro) {
  const el = obterElementoRecomendacoes();
  if (!el) return;
  const sugestoes = recomendarMesmaArea(id, livro);
  el.textContent = sugestoes.length
    ? `📌 Recomendado em ${livro.area}: ${sugestoes.join(" • ")}`
    : "";
}

function definirEstadoEmprestimo(mensagem, estado) {
  const elemento = $("livro-status");
  if (elemento) {
    elemento.textContent = mensagem;
    elemento.className = `loan-status ${estado}`;
  }
}

function mostrarErroLivro(mensagem) {
  $("card-livro")?.classList.remove("hidden");
  if ($("livro-area")) $("livro-area").textContent = "Aviso";
  if ($("livro-categoria")) $("livro-categoria").textContent = "Não Cadastrado";
  if ($("livro-titulo")) $("livro-titulo").textContent = "Livro não encontrado";
  if ($("livro-autor")) $("livro-autor").textContent = "-";
  if ($("livro-sinopse")) $("livro-sinopse").textContent = "A classe reconhecida não tem correspondência no arquivo de catálogo.";
  if ($("livro-capa")) $("livro-capa").textContent = "❓";
  limparRecomendacoes();
  definirEstadoEmprestimo(mensagem, "error");
}

function calcularDevolucao(prazoDias) {
  const data = new Date();
  data.setDate(data.getDate() + Number(prazoDias || 0));
  return data;
}

function formatarData(data) {
  if (!(data instanceof Date) || isNaN(data)) return "--/--/----";
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/* ---------------------------- HISTÓRICO / INTERFACE ----------------------- */

function atualizarHistoricoDOM() {
  const lista = $("lista-historico");
  if (!lista) return;
  lista.replaceChildren();

  if (historicoSessao.length === 0) {
    lista.innerHTML = `
      <li class="history-empty">
        <strong>A sua estante está à espera</strong>
        <p>Os livros reconhecidos aparecerão aqui.</p>
      </li>
    `;
  } else {
    historicoSessao.forEach((livro, index) => {
      const item = document.createElement("li");
      item.className = "history-item";
      item.style.cursor = "pointer";

      item.addEventListener("click", () => {
        mostrarDetalhesLivro(livro.id, livro);
      });

      const icone = document.createElement("span");
      icone.className = "history-book-icon";
      definirCapa(icone, livro);

      const copia = document.createElement("div");
      copia.className = "history-book-copy";

      const titulo = document.createElement("strong");
      titulo.textContent = livro.titulo;

      const categoria = document.createElement("small");
      categoria.textContent = livro.categoria;

      const devolucao = document.createElement("small");
      devolucao.className = "history-due";
      devolucao.textContent = `Devolução: ${formatarData(livro.dataDevolucao)}`;

      copia.append(titulo, categoria, devolucao);

      const btnRemover = document.createElement("button");
      btnRemover.type = "button";
      btnRemover.className = "btn-remover-item";
      btnRemover.setAttribute("aria-label", "Remover livro");
      btnRemover.textContent = "✕";
      
      btnRemover.addEventListener("click", (e) => {
        e.stopPropagation();
        removerLivroDoHistorico(index);
      });

      item.append(icone, copia, btnRemover);
      lista.appendChild(item);
    });
  }
  atualizarInterfaceSessao();
}

function removerLivroDoHistorico(index) {
  if (!Array.isArray(historicoSessao) || index < 0 || index >= historicoSessao.length) {
    console.warn("Índice inválido para remoção:", index);
    return;
  }

  const removidos = historicoSessao.splice(index, 1);
  const livroRemovido = removidos[0];

  if (!livroRemovido) return;

  if (ultimoLivroLido === livroRemovido.id) {
    ultimoLivroLido = null;
  }

  const cardLivro = $("card-livro");
  if (cardLivro) {
    cardLivro.classList.add("hidden");
  }

  atualizarHistoricoDOM();

  const statusLeitura = $("status-leitura");
  if (statusLeitura) {
    const titulo = livroRemovido.titulo || "O livro";
    statusLeitura.textContent = `"${titulo}" foi removido da estante.`;
  }
}

function atualizarInterfaceSessao() {
  const quantidade = historicoSessao.length;
  if ($("contador-volumes")) $("contador-volumes").textContent = quantidade;
  if ($("total-historico")) $("total-historico").textContent = `${quantidade} ${quantidade === 1 ? "livro" : "livros"}`;
  if ($("btn-finalizar")) $("btn-finalizar").disabled = quantidade === 0 || atendimentoFinalizado;
  if ($("progresso-sessao")) {
    $("progresso-sessao").style.width = `${Math.min((quantidade / LIMITE_VOLUMES) * 100, 100)}%`;
  }
  if ($("texto-contador")) {
    if (quantidade === 0) $("texto-contador").textContent = "Ainda não selecionou nenhum livro.";
    else $("texto-contador").textContent = `${quantidade} de ${LIMITE_VOLUMES} volumes adicionados.`;
  }
}

/* ---------------------- MODAL DE REVISÃO E COMPROVANTE -------------------- */

function solicitarRevisaoOuFinalizar() {
  if (historicoSessao.length === 0 || atendimentoFinalizado) return;

  const modalRevisao = $("modal-revisao");
  if (modalRevisao) {
    abrirRevisaoModal();
  } else {
    finalizarAtendimento();
  }
}

function abrirRevisaoModal() {
  const containerLista = $("revisao-lista-livros");
  if (containerLista) {
    containerLista.replaceChildren();

    historicoSessao.forEach((livro) => {
      const item = document.createElement("li");
      item.className = "history-item";

      const icone = document.createElement("span");
      icone.className = "history-book-icon";
      definirCapa(icone, livro);

      const copia = document.createElement("div");
      copia.className = "history-book-copy";

      const titulo = document.createElement("strong");
      titulo.textContent = livro.titulo;

      const categoria = document.createElement("small");
      categoria.textContent = `${livro.area || ''} • ${livro.categoria || ''}`;

      const devolucao = document.createElement("small");
      devolucao.className = "history-due";
      devolucao.textContent = `Devolução em: ${formatarData(livro.dataDevolucao)} (${livro.prazoDias || 14} dias)`;

      copia.append(titulo, categoria, devolucao);
      item.append(icone, copia);
      containerLista.appendChild(item);
    });
  }

  $("modal-revisao")?.classList.remove("hidden");
}

function fecharRevisaoModal() {
  $("modal-revisao")?.classList.add("hidden");
}

function emitirComprovanteFinal() {
  fecharRevisaoModal();
  finalizarAtendimento();
}

function finalizarAtendimento() {
  if (historicoSessao.length === 0 || atendimentoFinalizado) return;

  atendimentoFinalizado = true;
  pararCamera();
  sessaoID = "BD-" + Date.now().toString().slice(-6);

  if ($("recibo-id")) $("recibo-id").textContent = sessaoID;
  if ($("recibo-data")) $("recibo-data").textContent = new Date().toLocaleString("pt-BR");
  if ($("recibo-qtd")) $("recibo-qtd").textContent = historicoSessao.length;

  const listaRecibo = $("recibo-livros");
  if (listaRecibo) {
    listaRecibo.replaceChildren();
    historicoSessao.forEach((livro) => {
      const item = document.createElement("li");
      item.textContent = `${livro.titulo} — devolução até ${formatarData(livro.dataDevolucao)}`;
      listaRecibo.appendChild(item);
    });
  }

  // Abre primeiro o modal para o elemento ter dimensões no DOM
  $("modal-comprovante")?.classList.remove("hidden");
  atualizarInterfaceSessao();

  // Desenha o QR Code com delay seguro
  setTimeout(() => {
    const qrContainer = $("qrcode-container");
    if (qrContainer) {
      qrContainer.replaceChildren();
      if (typeof QRCode !== "undefined") {
        try {
          new QRCode(qrContainer, {
            text: `Sessao: ${sessaoID}\nQuantidade: ${historicoSessao.length}`,
            width: 128,
            height: 128,
            colorDark: "#2a1d22",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
          });
        } catch (erro) {
          console.error("Erro ao gerar QR Code:", erro);
          qrContainer.textContent = "Erro ao carregar QR Code.";
        }
      } else {
        console.warn("Biblioteca QRCode não está carregada no HTML.");
        qrContainer.textContent = "Biblioteca QR Code indisponível.";
      }
    }
  }, 50);
}

function imprimirComprovante() {
  window.print();
}

function fecharModal() {
  $("modal-comprovante")?.classList.add("hidden");
  historicoSessao = [];
  ultimoLivroLido = null;
  atendimentoFinalizado = false;
  pausaDetecao = false;
  contagemErro = 0;
  reiniciarConfirmacao();

  $("card-livro")?.classList.add("hidden");
  limparRecomendacoes();
  atualizarHistoricoDOM();
  mostrarBoasVindas();

  if ($("btn-camera")) $("btn-camera").disabled = false;
}

/* ------------------------------ PARAR CÂMERA ------------------------------ */

function pararCamera() {
  cameraAtiva = false;
  pausaDetecao = false;
  contagemErro = 0;

  if (animFrameID) {
    window.cancelAnimationFrame(animFrameID);
    animFrameID = null;
  }

  if (webcam) {
    try { webcam.stop(); } catch (e) {}
    webcam = null;
  }

  const container = $("webcam-container");
  if (container) {
    if (placeholderOriginal) container.replaceChildren(placeholderOriginal);
    else container.replaceChildren();
  }

  ultimoLivroLido = null;
  reiniciarConfirmacao();
  document.querySelector(".scan-indicator")?.classList.remove("is-active");
  if ($("btn-camera")) $("btn-camera").textContent = "Ativar câmera";
  if ($("texto-scanner")) $("texto-scanner").textContent = "Câmera desativada";
  if ($("status-leitura")) $("status-leitura").textContent = "Ative a câmera para iniciar o reconhecimento.";
  definirEstadoIA("aguardar", "Desativada");
  definirEstadoSistema("aguardar", "Em pausa");
}

window.addEventListener("beforeunload", () => {
  if (temporizadorRelogio) clearInterval(temporizadorRelogio);
  pararCamera();
});