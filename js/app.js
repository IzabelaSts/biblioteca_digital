const URL_MODELO = "https://teachablemachine.withgoogle.com/models/CaH3gJl7a/";

let model = null;
let webcam = null;
let cameraAtiva = false;
let cameraEmInicializacao = false;
let atendimentoFinalizado = false;
let ultimoLivroLido = null;
let historicoSessao = [];
let livrosBloqueados = new Set();
let temporizadorRelogio = null;
let sessaoID = null;

const LIMITE_VOLUMES = 10;
const LIMIAR_RECONHECIMENTO = 0.95;

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", iniciarAplicacao);

function iniciarAplicacao() {
  atualizarRelogio();
  temporizadorRelogio = window.setInterval(atualizarRelogio, 1000);

  atualizarInterfaceSessao();
  configurarBotaoCamera();

  $("btn-finalizar")?.addEventListener("click", finalizarAtendimento);
  $("btn-fechar-modal")?.addEventListener("click", fecharModal);
  $("btn-nova-sessao")?.addEventListener("click", fecharModal);
  $("btn-imprimir")?.addEventListener("click", imprimirComprovante);

  iniciarReconhecimento();
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
  if (cameraEmInicializacao || cameraAtiva) return;
  cameraEmInicializacao = true;

  if ($("btn-camera")) $("btn-camera").disabled = true;
  if ($("status-leitura")) $("status-leitura").textContent = "A preparar o modelo de reconhecimento...";
  if ($("texto-scanner")) $("texto-scanner").textContent = "A preparar a câmara...";
  
  definirEstadoSistema("aguardar", "A preparar sistema");
  definirEstadoIA("aguardar", "A iniciar");

  try {
    if (!window.tmImage) throw new Error("A biblioteca de reconhecimento não foi carregada.");

    if (!model) {
      const modelURL = URL_MODELO + "model.json";
      const metadataURL = URL_MODELO + "metadata.json";
      model = await tmImage.load(modelURL, metadataURL);
    }

    const flip = true;
    webcam = new tmImage.Webcam(320, 240, flip);
    await webcam.setup();

    $("camera-placeholder")?.remove();
    await webcam.play();

    if ($("webcam-container")) $("webcam-container").replaceChildren(webcam.canvas);

    cameraAtiva = true;

    if ($("btn-camera")) $("btn-camera").textContent = "Desativar câmara";
    if ($("texto-scanner")) $("texto-scanner").textContent = "Câmara ativa — aproxime a capa do livro";
    if ($("status-leitura")) $("status-leitura").textContent = "Aproxime a capa do livro para reconhecimento.";

    document.querySelector(".scan-indicator")?.classList.add("is-active");

    definirEstadoSistema("ativo", "Sistema ativo");
    definirEstadoIA("pronto", "IA pronta");

    window.requestAnimationFrame(cicloReconhecimento);
  } catch (error) {
    console.error("Erro ao iniciar o reconhecimento:", error);
    cameraAtiva = false;
    definirEstadoSistema("erro", "Verifique a câmara");
    definirEstadoIA("erro", "Indisponível");

    if ($("status-leitura")) $("status-leitura").textContent = traduzirErroCamera(error);
    if ($("texto-scanner")) $("texto-scanner").textContent = "Não foi possível iniciar a leitura.";

    $("camera-placeholder")?.remove();
    if ($("webcam-container") && !$("webcam-container").querySelector("canvas")) {
      mostrarPlaceholderCamera("Câmara indisponível", "Verifique as permissões e tente novamente.");
    }
  } finally {
    cameraEmInicializacao = false;
    if ($("btn-camera")) $("btn-camera").disabled = false;
  }
}

function traduzirErroCamera(error) {
  if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
    return "Permita o acesso à câmara nas definições do navegador.";
  }
  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
    return "Não foi encontrada nenhuma câmara disponível.";
  }
  if (error?.name === "NotReadableError") {
    return "A câmara pode estar a ser utilizada por outra aplicação.";
  }
  return error?.message || "Não foi possível ligar à câmara ou carregar o modelo.";
}

function mostrarPlaceholderCamera(titulo, mensagem) {
  const placeholder = document.createElement("div");
  placeholder.id = "camera-placeholder";
  placeholder.className = "camera-placeholder";

  const icone = document.createElement("div");
  icone.className = "camera-icon";
  icone.textContent = "📷";

  const tituloElemento = document.createElement("strong");
  tituloElemento.textContent = titulo;

  const mensagemElemento = document.createElement("p");
  mensagemElemento.textContent = mensagem;

  placeholder.append(icone, tituloElemento, mensagemElemento);

  if ($("webcam-container")) $("webcam-container").replaceChildren(placeholder);
}

async function cicloReconhecimento() {
  if (!cameraAtiva || !webcam || !model) return;
  try {
    webcam.update();
    await preverLivro();
  } catch (error) {
    console.error("Erro durante o reconhecimento:", error);
    if ($("status-leitura")) $("status-leitura").textContent = "Erro durante a leitura. Tente novamente.";
  }

  if (cameraAtiva) {
    window.requestAnimationFrame(cicloReconhecimento);
  }
}

async function preverLivro() {
  const previsoes = await model.predict(webcam.canvas);
  const melhor = previsoes.reduce((anterior, atual) =>
    atual.probability > anterior.probability ? atual : anterior
  );

  if (melhor.probability < LIMIAR_RECONHECIMENTO) {
    ultimoLivroLido = null;
    if ($("status-leitura")) $("status-leitura").textContent = "Aproxime a capa do livro e mantenha-a estável.";
    if ($("texto-scanner")) $("texto-scanner").textContent = "À procura de um livro...";
    return;
  }

  const idLivro = melhor.className;

  if ($("status-leitura")) {
    $("status-leitura").textContent = `Livro identificado (${Math.round(melhor.probability * 100)}%).`;
  }
  if ($("texto-scanner")) $("texto-scanner").textContent = "Livro reconhecido pela câmara.";

  if (idLivro === ultimoLivroLido) return;

  ultimoLivroLido = idLivro;
  processarEmprestimo(idLivro);
}

function processarEmprestimo(idLivro) {
  if (atendimentoFinalizado) return;

  const livro = CATALOGO_LIVROS[idLivro];

  if (!livro) {
    mostrarErroLivro(`O livro identificado (${idLivro}) não está no catálogo.`);
    return;
  }

  mostrarDetalhesLivro(livro);

  if (livro.restricao) {
    definirEstadoEmprestimo(`Consulta local apenas. O empréstimo de "${livro.titulo}" não está autorizado.`, "error");
    return;
  }

  if (historicoSessao.some((item) => item.id === idLivro)) {
    definirEstadoEmprestimo("Este livro já está registado nesta sessão.", "success");
    return;
  }

  if (historicoSessao.length >= LIMITE_VOLUMES) {
    definirEstadoEmprestimo(`Limite de ${LIMITE_VOLUMES} volumes por sessão atingido.`, "error");
    return;
  }

  if (livrosBloqueados.has(idLivro)) {
    definirEstadoEmprestimo("Este livro já foi processado nesta sessão.", "error");
    return;
  }

  const dataDevolucao = calcularDevolucao(livro.prazoDias);

  historicoSessao.push({
    id: idLivro,
    ...livro,
    dataEmprestimo: new Date(),
    dataDevolucao
  });

  livrosBloqueados.add(idLivro);
  definirEstadoEmprestimo(`Empréstimo autorizado. Devolução prevista até ${formatarData(dataDevolucao)}.`, "success");
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
  if ($("livro-area")) $("livro-area").textContent = "Catálogo";
  if ($("livro-categoria")) $("livro-categoria").textContent = "Não identificado";
  if ($("livro-titulo")) $("livro-titulo").textContent = "Livro não registado";
  if ($("livro-autor")) $("livro-autor").textContent = "Autor desconhecido";
  if ($("livro-sinopse")) $("livro-sinopse").textContent = "Não foi possível associar a imagem a um livro do catálogo.";
  if ($("livro-capa")) $("livro-capa").textContent = "📖";
  definirEstadoEmprestimo(mensagem, "error");
}

function calcularDevolucao(prazoDias) {
  const data = new Date();
  data.setDate(data.getDate() + prazoDias);
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
    const itemVazio = document.createElement("li");
    itemVazio.className = "history-empty";

    const icone = document.createElement("span");
    icone.className = "empty-book";
    icone.textContent = "📚";

    const titulo = document.createElement("strong");
    titulo.textContent = "A sua estante está à espera";

    const texto = document.createElement("p");
    texto.textContent = "Os livros reconhecidos aparecerão aqui.";

    itemVazio.append(icone, titulo, texto);
    lista.appendChild(itemVazio);
  } else {
    historicoSessao.forEach((livro) => {
      const item = document.createElement("li");
      item.className = "history-item";

      const icone = document.createElement("span");
      icone.className = "history-book-icon";
      icone.textContent = livro.capa || "📖";

      const conteudo = document.createElement("div");
      conteudo.className = "history-book-copy";

      const titulo = document.createElement("strong");
      titulo.textContent = livro.titulo;

      const categoria = document.createElement("small");
      categoria.textContent = livro.categoria;

      const devolucao = document.createElement("small");
      devolucao.className = "history-due";
      devolucao.textContent = `Devolução: ${formatarData(livro.dataDevolucao)}`;

      conteudo.append(titulo, categoria, devolucao);
      item.append(icone, conteudo);
      lista.appendChild(item);
    });
  }

  atualizarInterfaceSessao();
}

function atualizarInterfaceSessao() {
  const quantidade = historicoSessao.length;

  if ($("contador-volumes")) $("contador-volumes").textContent = quantidade;
  if ($("total-historico")) $("total-historico").textContent = quantidade;

  if ($("btn-finalizar")) {
    $("btn-finalizar").disabled = quantidade === 0 || atendimentoFinalizado;
  }

  if ($("progresso-sessao")) {
    $("progresso-sessao").style.width = `${Math.min((quantidade / LIMITE_VOLUMES) * 100, 100)}%`;
  }

  if ($("texto-contador")) {
    if (quantidade === 0) $("texto-contador").textContent = "Ainda não selecionou nenhum livro.";
    else if (quantidade === 1) $("texto-contador").textContent = "Tem 1 livro nesta sessão.";
    else $("texto-contador").textContent = `Tem ${quantidade} livros nesta sessão.`;
  }
}

function finalizarAtendimento() {
  if (historicoSessao.length === 0 || atendimentoFinalizado) return;

  atendimentoFinalizado = true;
  sessaoID = "BD-" + Date.now().toString().slice(-8);

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

  const resumo = {
    biblioteca: "Biblioteca Digital",
    sessao: sessaoID,
    data: new Date().toISOString(),
    volumes: historicoSessao.map((livro) => ({
      titulo: livro.titulo,
      autor: livro.autor,
      devolucao: formatarData(livro.dataDevolucao)
    }))
  };

  const qrContainer = $("qrcode-container");
  if (qrContainer) {
    qrContainer.replaceChildren();
    if (window.QRCode) {
      new QRCode(qrContainer, {
        text: JSON.stringify(resumo),
        width: 140,
        height: 140,
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      qrContainer.textContent = "QR Code indisponível. Utilize a opção de impressão.";
    }
  }

  $("modal-comprovante")?.classList.remove("hidden");

  if ($("btn-finalizar")) $("btn-finalizar").disabled = true;
  if ($("btn-camera")) $("btn-camera").disabled = true;
}

function imprimirComprovante() {
  window.print();
}

function fecharModal() {
  $("modal-comprovante")?.classList.add("hidden");

  historicoSessao = [];
  livrosBloqueados = new Set();
  ultimoLivroLido = null;
  atendimentoFinalizado = false;
  sessaoID = null;

  $("card-livro")?.classList.add("hidden");

  if ($("recibo-livros")) $("recibo-livros").replaceChildren();
  if ($("qrcode-container")) $("qrcode-container").replaceChildren();

  atualizarHistoricoDOM();

  if ($("status-leitura")) {
    $("status-leitura").textContent = cameraAtiva
      ? "Sessão reiniciada. Aproxime a capa do próximo livro."
      : "Sessão reiniciada. Ative a câmara para continuar.";
  }

  if ($("btn-camera")) $("btn-camera").disabled = false;
  if ($("texto-scanner")) {
    $("texto-scanner").textContent = cameraAtiva
      ? "Câmara ativa — aproxime a capa do livro"
      : "Ative a câmara para começar.";
  }
}

function pararCamera() {
  cameraAtiva = false;

  if (webcam) {
    try {
      webcam.stop();
    } catch (error) {
      console.warn("Não foi possível parar a câmara:", error);
    }
    webcam = null;
  }

  if ($("webcam-container")) $("webcam-container").replaceChildren();

  mostrarPlaceholderCamera("Câmara desativada", "Ative a câmara quando estiver pronto.");

  if ($("btn-camera")) $("btn-camera").textContent = "Ativar câmara";
  if ($("texto-scanner")) $("texto-scanner").textContent = "Câmara desativada";
  if ($("status-leitura")) $("status-leitura").textContent = "A câmara foi desligada.";

  document.querySelector(".scan-indicator")?.classList.remove("is-active");

  definirEstadoIA("aguardar", "Em pausa");
  definirEstadoSistema("aguardar", "Em pausa");
}

window.addEventListener("beforeunload", () => {
  if (temporizadorRelogio) clearInterval(temporizadorRelogio);
  if (webcam) {
    try {
      webcam.stop();
    } catch (error) {
      console.warn(error);
    }
  }
});