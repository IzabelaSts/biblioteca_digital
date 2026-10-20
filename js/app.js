/* =====================================================================
   BIBLIOTECA DIGITAL — Reconhecimento e Empréstimo de Livros
   Arquivo: js/app.js
   ===================================================================== */

/* ------------------------------ CONFIGURAÇÃO ------------------------------ */

// Link do modelo exportado do Teachable Machine (atualize a cada novo treino)
const URL_MODELO = "https://teachablemachine.withgoogle.com/models/8_uI-T1lu/";

// Confiança mínima para aceitar um livro (0.75 = 75%)
const LIMIAR_RECONHECIMENTO = 0.75;

// Quantos quadros seguidos o MESMO livro precisa aparecer (evita leituras falsas)
const QUADROS_PARA_CONFIRMAR = 3;

// Nome da classe "sem livro" criada no Teachable Machine (mesa vazia, mão, ambiente).
// Se não existir essa classe, não há problema.
const CLASSE_FUNDO = "Fundo";

// Espelhar o quadro antes de prever.
// true  -> modelo treinado pela WEBCAM do Teachable Machine (ele espelha as amostras)
// false -> modelo treinado com fotos enviadas como arquivo
const ESPELHAR_IMAGEM = false;

// Mostra as 3 melhores previsões na tela (útil para testar; ponha false na apresentação)
const MODO_DEPURACAO = false;

const LIMITE_VOLUMES = 10;
const INTERVALO_PREDICAO_MS = 150;
const TEMPO_LIMITE_MODELO_MS = 30000;

/* --------------------------------- ESTADO --------------------------------- */

let model = null;
let videoElement = null;
let streamAtual = null;
let placeholderOriginal = null;
let cameraAtiva = false;
let cameraEmInicializacao = false;
let atendimentoFinalizado = false;
let ultimoLivroLido = null;
let historicoSessao = [];
let temporizadorRelogio = null;
let temporizadorCiclo = null;
let sessaoID = null;
let candidato = null;
let cicloId = 0; // identifica o laço ativo (evita dois laços ao reativar a câmera)
let contagemCandidato = 0;

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", iniciarAplicacao);

function iniciarAplicacao() {
  atualizarRelogio();
  temporizadorRelogio = window.setInterval(atualizarRelogio, 1000);
  atualizarInterfaceSessao();
  atualizarHistoricoDOM();
  configurarBotaoCamera();
  mostrarBoasVindas();

  $("btn-finalizar")?.addEventListener("click", finalizarAtendimento);
  $("btn-fechar-modal")?.addEventListener("click", fecharModal);
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
  const mensagem = `${saudacao()}! Bem-vindo à Biblioteca Digital. Ative a câmera e aproxime a capa de um livro.`;
  if ($("status-leitura")) $("status-leitura").textContent = mensagem;
  if ($("mensagem-boas-vindas")) $("mensagem-boas-vindas").textContent = mensagem;
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
    // Recuperação: se o comprovante não está aberto, nenhum atendimento está "finalizado"
    const modalAberto = !$("modal-comprovante")?.classList.contains("hidden");
    if (!modalAberto) atendimentoFinalizado = false;
    cameraEmInicializacao = false; // o botão fica desativado durante a inicialização, então é seguro
    await iniciarReconhecimento();
  });
}

// Tenta a câmera traseira (celular); se não houver (notebook), usa qualquer câmera.
async function obterStreamCamera() {
  const tentativas = [
    { video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
    { video: true, audio: false }
  ];
  let ultimoErro = null;
  for (const constraints of tentativas) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (erro) {
      ultimoErro = erro;
      if (erro?.name === "NotAllowedError" || erro?.name === "PermissionDeniedError") break;
    }
  }
  throw ultimoErro;
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
      () => rejeitar(new Error("Tempo esgotado ao carregar o modelo. Verifique a internet e se o modelo é público.")),
      TEMPO_LIMITE_MODELO_MS
    )
  );

  model = await Promise.race([carregamento, limite]);
  return model;
}

async function iniciarReconhecimento() {
  if (cameraEmInicializacao || cameraAtiva || atendimentoFinalizado) return;
  cameraEmInicializacao = true;
  cicloId++;
  liberarStream(); // garante que não sobrou stream antigo

  if ($("btn-camera")) $("btn-camera").disabled = true;
  if ($("status-leitura")) $("status-leitura").textContent = "Solicitando acesso à câmera...";
  if ($("texto-scanner")) $("texto-scanner").textContent = "Solicitando acesso à câmera...";
  definirEstadoSistema("aguardar", "Preparando sistema");
  definirEstadoIA("aguardar", "Carregando");

  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("A câmera só funciona em HTTPS ou em localhost. Abra a página por https:// ou http://localhost.");
    }

    // 1) Câmera primeiro
    streamAtual = await obterStreamCamera();

    videoElement = document.createElement("video");
    videoElement.srcObject = streamAtual;
    videoElement.muted = true;
    videoElement.playsInline = true;
    videoElement.autoplay = true;
    videoElement.setAttribute("playsinline", "");
    videoElement.setAttribute("muted", "");
    videoElement.style.width = "100%";
    videoElement.style.height = "100%";
    videoElement.style.objectFit = "cover";

    const container = $("webcam-container");
    if (container) {
      const placeholder = $("camera-placeholder");
      if (placeholder) placeholderOriginal = placeholder;
      container.replaceChildren(videoElement);
    }

    await videoElement.play();

    if ($("texto-scanner")) $("texto-scanner").textContent = "Câmera ativa — carregando IA...";
    if ($("status-leitura")) $("status-leitura").textContent = "Carregando modelo da IA...";

    // 2) Modelo depois
    await carregarModelo();

    cameraAtiva = true;
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

    agendarProximoCiclo();
  } catch (error) {
    console.error("Erro detalhado ao iniciar a câmera:", error);
    liberarStream();
    cameraAtiva = false;
    definirEstadoSistema("erro", "Erro de câmera");
    definirEstadoIA("erro", "Erro");
    if ($("status-leitura")) $("status-leitura").textContent = traduzirErroCamera(error);
    if ($("texto-scanner")) $("texto-scanner").textContent = "Não foi possível iniciar o reconhecimento.";
    if ($("btn-camera")) $("btn-camera").textContent = "Ativar câmera";
  } finally {
    cameraEmInicializacao = false;
    if ($("btn-camera")) $("btn-camera").disabled = atendimentoFinalizado;
  }
}

function traduzirErroCamera(error) {
  const nome = error?.name;
  if (nome === "NotAllowedError" || nome === "PermissionDeniedError") {
    return "Permissão negada! Permita o acesso à câmera nas definições do navegador (ícone do cadeado).";
  }
  if (nome === "NotFoundError" || nome === "DevicesNotFoundError") return "Nenhuma câmera encontrada no dispositivo.";
  if (nome === "NotReadableError" || nome === "TrackStartError") {
    return "A câmera está em uso por outro programa (Zoom, Teams, outra aba...). Feche-o e tente de novo.";
  }
  return error?.message || "Erro ao conectar com a câmera.";
}

function liberarStream() {
  try {
    streamAtual?.getTracks().forEach((track) => track.stop());
  } catch (e) { /* ignora */ }
  streamAtual = null;
  videoElement = null;
}

/* ----------------------------- RECONHECIMENTO ----------------------------- */

function reiniciarConfirmacao() {
  candidato = null;
  contagemCandidato = 0;
}

function agendarProximoCiclo() {
  clearTimeout(temporizadorCiclo);
  if (!cameraAtiva) return;
  const id = cicloId;
  temporizadorCiclo = setTimeout(() => cicloReconhecimento(id), INTERVALO_PREDICAO_MS);
}

async function cicloReconhecimento(id) {
  if (id !== cicloId || !cameraAtiva || !videoElement || !model) return;

  try {
    if (videoElement.readyState >= 2 && videoElement.videoWidth > 0) {
      await preverLivro();
    }
  } catch (error) {
    console.error("Erro no ciclo de reconhecimento:", error);
  }

  if (id === cicloId) agendarProximoCiclo();
}

async function preverLivro() {
  const previsoes = await model.predict(videoElement, ESPELHAR_IMAGEM);
  if (!previsoes?.length || !cameraAtiva) return;

  const ordenadas = [...previsoes].sort((a, b) => b.probability - a.probability);
  const melhor = ordenadas[0];
  const idLivro = melhor.className;
  const porcentagem = Math.round(melhor.probability * 100);

  if ($("status-leitura")) {
    $("status-leitura").textContent = MODO_DEPURACAO
      ? ordenadas.slice(0, 3).map((p) => `${p.className} ${Math.round(p.probability * 100)}%`).join("  |  ")
      : `Lendo: '${idLivro}' (${porcentagem}%).`;
  }

  // Sem livro à vista (classe de fundo ou confiança baixa)
  if (idLivro === CLASSE_FUNDO || melhor.probability < LIMIAR_RECONHECIMENTO) {
    reiniciarConfirmacao();
    ultimoLivroLido = null;
    if ($("texto-scanner")) $("texto-scanner").textContent = "À procura de um livro...";
    return;
  }

  // Exige o MESMO livro por alguns quadros seguidos
  if (idLivro === candidato) {
    contagemCandidato++;
  } else {
    candidato = idLivro;
    contagemCandidato = 1;
  }
  if (contagemCandidato < QUADROS_PARA_CONFIRMAR) {
    if ($("texto-scanner")) $("texto-scanner").textContent = "Confirmando leitura...";
    return;
  }

  if ($("texto-scanner")) $("texto-scanner").textContent = "Livro reconhecido!";

  // Já processado e ainda está na frente da câmera: não repete
  if (idLivro === ultimoLivroLido) {
    if ($("texto-scanner")) $("texto-scanner").textContent = "Livro já lido — mostre o próximo livro";
    return;
  }

  ultimoLivroLido = idLivro;
  processarEmprestimo(idLivro);
}

/* -------------------------------- CATÁLOGO -------------------------------- */

// Remove acentos, espaços extras e maiúsculas para comparar nomes
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

// Devolve { id, livro } ; aceita pequenas diferenças de acento/maiúscula
function localizarNoCatalogo(idLivro) {
  const catalogo = catalogoDisponivel();
  if (!catalogo) return null;
  if (catalogo[idLivro]) return { id: idLivro, livro: catalogo[idLivro] };

  const alvo = normalizar(idLivro);
  const chave = Object.keys(catalogo).find((k) => normalizar(k) === alvo);
  return chave ? { id: chave, livro: catalogo[chave] } : null;
}

// Recomenda até 2 outros livros da mesma área que ainda não foram retirados
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

// Registro AUTOMÁTICO: ao reconhecer, valida regras e adiciona ao histórico.
function processarEmprestimo(idReconhecido) {
  if (atendimentoFinalizado) return;

  const encontrado = localizarNoCatalogo(idReconhecido);

  if (!encontrado) {
    mostrarErroLivro(`Classe '${idReconhecido}' reconhecida, mas não cadastrada no catalog.js.`);
    return;
  }

  const { id, livro } = encontrado;
  mostrarDetalhesLivro(id, livro);

  // Regra 1: restrição de empréstimo (consulta local)
  if (livro.restricao) {
    definirEstadoEmprestimo(`Consulta local apenas. "${livro.titulo}" indisponível para empréstimo.`, "error");
    return;
  }

  // Regra 2: livro já registado nesta sessão
  if (historicoSessao.some((item) => item.id === id)) {
    definirEstadoEmprestimo("Este livro já foi adicionado à estante nesta sessão.", "success");
    return;
  }

  // Regra 3: limite de volumes por atendimento
  if (historicoSessao.length >= LIMITE_VOLUMES) {
    definirEstadoEmprestimo(`Limite de ${LIMITE_VOLUMES} volumes atingido.`, "error");
    return;
  }

  // Regra 4: calcula o prazo de devolução e registra
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

  // Feedback no telemóvel
  if (navigator.vibrate) navigator.vibrate(200);
}

function mostrarDetalhesLivro(id, livro) {
  $("card-livro")?.classList.remove("hidden");
  if ($("livro-area")) $("livro-area").textContent = `Área: ${livro.area}`;
  if ($("livro-categoria")) $("livro-categoria").textContent = livro.categoria;
  if ($("livro-titulo")) $("livro-titulo").textContent = livro.titulo;
  if ($("livro-autor")) $("livro-autor").textContent = livro.autor;
  if ($("livro-sinopse")) $("livro-sinopse").textContent = livro.sinopse;
  if ($("livro-capa")) $("livro-capa").textContent = livro.capa || "📖";
  limparRecomendacoes();
}

// Cria (se não existir no HTML) a linha de recomendações dentro do card
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
        <span class="empty-book">📚</span>
        <strong>A sua estante está à espera</strong>
        <p>Os livros reconhecidos aparecerão aqui.</p>
      </li>
    `;
  } else {
    historicoSessao.forEach((livro) => {
      const item = document.createElement("li");
      item.className = "history-item";

      const icone = document.createElement("span");
      icone.className = "history-book-icon";
      icone.textContent = livro.capa || "📖";

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
      item.append(icone, copia);
      lista.appendChild(item);
    });
  }
  atualizarInterfaceSessao();
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

/* -------------------------------- COMPROVANTE ----------------------------- */

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
      try {
        new QRCode(qrContainer, {
          text: `Sessao ${sessaoID} - ${historicoSessao.length} livro(s)`,
          width: 130,
          height: 130
        });
      } catch (erro) {
        console.error("Não foi possível gerar o QR code:", erro);
      }
    }
  }

  $("modal-comprovante")?.classList.remove("hidden");
  atualizarInterfaceSessao();
}

function imprimirComprovante() {
  window.print();
}

function fecharModal() {
  $("modal-comprovante")?.classList.add("hidden");
  historicoSessao = [];
  ultimoLivroLido = null;
  atendimentoFinalizado = false;
  reiniciarConfirmacao();

  $("card-livro")?.classList.add("hidden");
  limparRecomendacoes();
  atualizarHistoricoDOM();
  mostrarBoasVindas();

  if ($("btn-camera")) $("btn-camera").disabled = false;
  iniciarReconhecimento(); // reabre a câmera automaticamente para o próximo atendimento
}

/* ------------------------------ PARAR CÂMERA ------------------------------ */

function pararCamera() {
  cameraAtiva = false;
  cicloId++;
  clearTimeout(temporizadorCiclo);
  liberarStream();

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