/*
 * Catálogo central de livros.
 * IMPORTANTE: As chaves (ex: "pequeno_principe", "ventos_uivantes") DEVEM ser idênticas
 * aos nomes das classes criadas no seu modelo do Teachable Machine.
 */
const CATALOGO_LIVROS = {
  "ventos_uivantes": {
    titulo: "O Morro dos Ventos Uivantes",
    autor: "Emily Brontë",
    categoria: "Romance clássico",
    area: "Literatura",
    sinopse: "Uma história intensa de amor, ressentimento e vingança.",
    prazoDias: 14,
    restricao: false,
    capa: "📗"
  },

  "pequeno_principe": {
    titulo: "O Pequeno Príncipe",
    autor: "Antoine de Saint-Exupéry",
    categoria: "Fábula",
    area: "Literatura",
    sinopse: "Uma viagem poética sobre amizade, amor e o que realmente importa.",
    prazoDias: 14,
    restricao: false,
    capa: "📘"
  },

  "romeu_julieta": {
    titulo: "Romeu e Julieta",
    autor: "William Shakespeare",
    categoria: "Tragédia teatral",
    area: "Literatura",
    sinopse: "Dois jovens apaixonados enfrentam o conflito entre suas famílias.",
    prazoDias: 7,
    restricao: false,
    capa: "📕"
  },

  "intermitencia_morte": {
    titulo: "As Intermitências da Morte",
    autor: "José Saramago",
    categoria: "Ficção filosófica",
    area: "Literatura",
    sinopse: "Num país não identificado, a morte decide suspender suas atividades e ninguém mais morre.",
    prazoDias: 14,
    restricao: false,
    capa: "🖤"
  }
};