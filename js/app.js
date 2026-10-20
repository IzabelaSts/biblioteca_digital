const URL_MODELO = "https://teachablemachine.withgoogle.com/models/CaH3gJl7a/";

let model = null;
let webcam = null;
let cameraAtiva = false;
let cameraEmInicializacao = false;
let atendimentoFinalizado = false;
let ultimoLivroLido = null;
let livroPendenteId = null;
let historicoSessao = [];
let livrosBloqueados = new Set();
let temporizadorRelogio = null;
let sessaoID = null;

const LIMITE_VOLUMES = 10;
const LIMIAR_RECONHECIMENTO = 0.85; // Ajustado para facilidade de leitura no telemóvel
const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", iniciarAplicacao);

function iniciarAplicacao() {
  atualizarRelogio();
  temporizadorRelogio = window.setInterval(atualizarRelogio, 1000);
  atualizarInterfaceSessao();
  atualizarHistoricoDOM();
  configurarBotaoCamera();

  $("btn-finalizar")?.addEventListener("click", finalizarAtendimento);
  $("btn-fechar-modal")?.addEventListener("click", fecharModal);
  $("btn-nova-sessao")?.addEventListener("click", fecharModal);
  $("btn-imprimir")?.addEventListener("click", imprimirComprovante);
}

function atualizarRelogio() {
  const agora = new Date();
  if ($("relogio")) {
    $("relogio").textContent = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  if ($("data-atual")) {
    $("data-atual").textContent = agora.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  }
}

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

function configurarBotaoCamera() {
  $("btn-camera")?.addEventListener("click", async () => {
    if (cameraAtiva) {
      pararCamera();
      return;
    }
    await iniciarReconhecimento();
  });
}

async function iniciarReconhecimento() {
  if (cameraEmInicializacao || cameraAtiva || atendimentoFinalizado) return;
  cameraEmInicializacao = true;
  if ($("btn-camera")) $("btn-camera").disabled = true;
  if ($("status-leitura")) $("status-leitura").textContent = "A carregar modelo do Teachable Machine...";
  if ($("texto-scanner")) $("texto-scanner").textContent = "A ligar câmara...";
  definirEstadoSistema("aguardar", "A preparar sistema");
  definirEstadoIA("aguardar", "A carregar");

  try {
    if (!window.tmImage) throw new Error("Biblioteca do Teachable Machine não encontrada.");
    if (!model) {
      model = await tmImage.load(URL_MODELO + "model.json", URL_MODELO + "metadata.json");
    }

    const flip = true; 
    webcam = new tmImage.Webcam(320, 240, flip);
    await webcam.setup({ facingMode: "environment" }); // Suporte preferencial para câmera traseira em telemóveis
    await webcam.play();

    $("camera-placeholder")?.remove();
    if ($("webcam-container")) {
      const container = $("webcam-container");
      const oldCanvas = container.querySelector("canvas");
      if (oldCanvas) oldCanvas.remove();
      container.appendChild(webcam.canvas);
    }
    
    cameraAtiva = true;

    if ($("btn-camera")) $("btn-camera").textContent = "Desativar câmera";
    if ($("texto-scanner")) $("texto-scanner").textContent = "Câmera ativa — aproxime o livro";
    if ($("status-leitura")) $("status-leitura").textContent = "Aproxime a capa do livro para o reconhecimento.";
    document.querySelector(".scan-indicator")?.classList.add("is-active");
    definirEstadoSistema("ativo", "Sistema ativo");
    definirEstadoIA("pronto", "IA Pronta");
    window.requestAnimationFrame(cicloReconhecimento);
  } catch (error) {
    console.error("Erro ao iniciar a câmera:", error);
    cameraAtiva = false;
    definirEstadoSistema("erro", "Erro de câmera");
    definirEstadoIA("erro", "Erro");
    if ($("status-leitura")) $("status-leitura").textContent = traduzirErroCamera(error);
    if ($("texto-scanner")) $("texto-scanner").textContent = "Não foi possível ligar a câmara.";
  } finally {
    cameraEmInicializacao = false;
    if ($("btn-camera")) $("btn-camera").disabled = atendimentoFinalizado;
  }
}

function traduzirErroCamera(error) {
  if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
    return "Permita o acesso à câmera nas configurações do telemóvel/navegador.";
  }
  if (error?.name === "NotFoundError") return "Nenhuma câmera foi encontrada.";
  return error?.message || "Erro de ligação com a câmera.";
}

async function cicloReconhecimento() {
  if (!cameraAtiva || !webcam || !model) return;
  try {
    webcam.update();
    await preverLivro();
  } catch (error) {
    console.error("Erro no ciclo:", error);
  }
  if (cameraAtiva) window.requestAnimationFrame(cicloReconhecimento);
}

async function preverLivro() {
  if (livroPendenteId) return;

  const previsoes = await model.predict(webcam.canvas);
  if (!previsoes?.length) return;

  const melhor = previsoes.reduce((anterior, atual) =>
    atual.probability > anterior.probability ? atual : anterior
  );

  if (melhor.probability < LIMIAR_RECONHECIMENTO) {
    ultimoLivroLido = null;
    if ($("status-leitura")) $("status-leitura").textContent = "Aproxime o livro e mantenha estável.";
    if ($("texto-scanner")) $("texto-scanner").textContent = "À procura de um livro...";
    return;
  }

  const idLivro = melhor.className;
  const porcentagem = Math.round(melhor.probability * 100);

  if ($("status-leitura")) {
    $("status-leitura").textContent = `Livro identificado (${porcentagem}% de certeza).`;
  }
  if ($("texto-scanner")) $("texto-scanner").textContent = "Livro reconhecido!";
  
  if (idLivro === ultimoLivroLido) return;

  ultimoLivroLido = idLivro;
  processarEmprestimo(idLivro);
}

function processarEmprestimo(idLivro) {
  if (atendimentoFinalizado) return;
  const livro = CATALOGO_LIVROS?.[idLivro];

  if (!livro) {
    mostrarErroLivro(`Classe '${idLivro}' não cadastrada no catalog.js.`);
    return;
  }

  mostrarDetalhesLivro(livro);
  removerBotaoConfirmacao();

  if (livro.restricao) {
    definirEstadoEmprestimo(`Consulta local apenas. "${livro.titulo}" indisponível para empréstimo.`, "error");
    return;
  }
  if (historicoSessao.some((item) => item.id === idLivro)) {
    definirEstadoEmprestimo("Este livro já foi adicionado à sessão.", "success");
    return;
  }
  if (historicoSessao.length >= LIMITE_VOLUMES) {
    definirEstadoEmprestimo(`Limite de ${LIMITE_VOLUMES} volumes atingido.`, "error");
    return;
  }

  livroPendenteId = idLivro;
  definirEstadoEmprestimo("Livro identificado! Clique no botão abaixo para confirmar.", "success");
  criarBotaoConfirmacao();
}

function criarBotaoConfirmacao() {
  const card = $("card-livro");
  if (!card) return;
  let botao = $("btn-confirmar-emprestimo");

  if (!botao) {
    botao = document.createElement("button");
    botao.id = "btn-confirmar-emprestimo";
    botao.type = "button";
    botao.className = "btn-confirmar-emprestimo";
    botao.textContent = "Confirmar Empréstimo";
    botao.addEventListener("click", confirmarEmprestimo);
    card.appendChild(botao);
  }
  botao.hidden = false;
  botao.disabled = false;
}

function removerBotaoConfirmacao() {
  const botao = $("btn-confirmar-emprestimo");
  if (botao) {
    botao.hidden = true;
    botao.disabled = true;
  }
}

function confirmarEmprestimo() {
  if (!livroPendenteId || atendimentoFinalizado) return;
  const idLivro = livroPendenteId;
  const livro = CATALOGO_LIVROS?.[idLivro];

  if (!livro) return;

  const dataDevolucao = calcularDevolucao(livro.prazoDias);
  historicoSessao.push({
    id: idLivro,
    ...livro,
    dataEmprestimo: new Date(),
    dataDevolucao
  });

  livroPendenteId = null;
  removerBotaoConfirmacao();
  definirEstadoEmprestimo(`Adicionado com sucesso! Devolução até ${formatarData(dataDevolucao)}.`, "success");
  atualizarHistoricoDOM();
}

function mostrarDetalhesLivro(livro) {
  $("card-livro")?.classList.remove("hidden");
  if ($("livro-area")) $("livro-area").textContent = livro.area;
  if ($("livro-categoria")) $("livro-categoria").textContent = livro.categoria;
  if ($("livro-titulo")) $("livro-titulo").textContent = livro.titulo;
  if ($("livro-autor")) $("livro-autor").textContent = livro.autor;
  if ($("livro-sinopse")) $("livro-sinopse").textContent = livro.sinopse;
  if ($("livro-capa")) $("livro-capa").textContent = livro.capa || "📖";
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
  removerBotaoConfirmacao();
  livroPendenteId = null;
  definirEstadoEmprestimo(mensagem, "error");
}

function calcularDevolucao(prazoDias) {
  const data = new Date();
  data.setDate(data.getDate() + Number(prazoDias || 0));
  return data;
}

function formatarData(data) {
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function atualizarHistoricoDOM() {
  const lista = $("lista-historico");
  if (!lista) return;
  lista.replaceChildren();

  if (historicoSessao.length === 0) {
    lista.innerHTML = `
      <li class="history-empty">
        <span class="empty-book">📚</span>
        <strong>A sua estante está à espera</strong>
        <p>Os livros reconhecidos aparecerão aqui.</p>
      </li>
    `;
  } else {
    historicoSessao.forEach((livro) => {
      const item = document.createElement("li");
      item.className = "history-item";
      item.innerHTML = `
        <span class="history-book-icon">${livro.capa || "📖"}</span>
        <div class="history-book-copy">
          <strong>${livro.titulo}</strong>
          <small>${livro.categoria}</small>
          <small class="history-due">Devolução: ${formatarData(livro.dataDevolucao)}</small>
        </div>
      `;
      lista.appendChild(item);
    });
  }
  atualizarInterfaceSessao();
}

function atualizarInterfaceSessao() {
  const quantidade = historicoSessao.length;
  if ($("contador-volumes")) $("contador-volumes").textContent = quantidade;
  if ($("total-historico")) $("total-historico").textContent = `${quantidade} ${quantidade === 1 ? 'livro' : 'livros'}`;
  if ($("btn-finalizar")) $("btn-finalizar").disabled = quantidade === 0 || atendimentoFinalizado;
  if ($("progresso-sessao")) {
    $("progresso-sessao").style.width = `${Math.min((quantidade / LIMITE_VOLUMES) * 100, 100)}%`;
  }
  if ($("texto-contador")) {
    if (quantidade === 0) $("texto-contador").textContent = "Ainda não selecionou nenhum livro.";
    else $("texto-contador").textContent = `${quantidade} de ${LIMITE_VOLUMES} volumes adicionados.`;
  }
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

  const qrContainer = $("qrcode-container");
  if (qrContainer) {
    qrContainer.replaceChildren();
    if (window.QRCode) {
      new QRCode(qrContainer, {
        text: `Sessão: ${sessaoID} | Total: ${historicoSessao.length} livro(s)`,
        width: 130,
        height: 130
      });
    }
  }

  $("modal-comprovante")?.classList.remove("hidden");
}

function imprimirComprovante() {
  window.print();
}

function fecharModal() {
  $("modal-comprovante")?.classList.add("hidden");
  historicoSessao = [];
  livrosBloqueados.clear();
  ultimoLivroLido = null;
  livroPendenteId = null;
  atendimentoFinalizado = false;

  removerBotaoConfirmacao();
  $("card-livro")?.classList.add("hidden");
  atualizarHistoricoDOM();

  if ($("btn-camera")) $("btn-camera").disabled = false;
}

function pararCamera() {
  cameraAtiva = false;
  if (webcam) {
    try { webcam.stop(); } catch (e) {}
    webcam = null;
  }
  document.querySelector(".scan-indicator")?.classList.remove("is-active");
  if ($("btn-camera")) $("btn-camera").textContent = "Ativar câmera";
  if ($("texto-scanner")) $("texto-scanner").textContent = "Câmera desativada";
  definirEstadoIA("aguardar", "Desativada");
  definirEstadoSistema("aguardar", "Em pausa");
}

window.addEventListener("beforeunload", () => {
  if (temporizadorRelogio) clearInterval(temporizadorRelogio);
  if (webcam) { try { webcam.stop(); } catch (e) {} }
});