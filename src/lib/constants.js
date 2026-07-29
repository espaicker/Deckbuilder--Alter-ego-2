/**
 * Design tokens e constantes compartilhadas do app.
 */

export const COLOR_HEX = Object.freeze({
  Vermelho: "#E14E2B",
  Verde: "#4C9A6A",
  Azul: "#3D8FCC",
  Amarelo: "#E3B324",
  Roxo: "#8C5FC7",
});

export const COLOR_HEX_SOFT = Object.freeze({
  Vermelho: "#E14E2B33",
  Verde: "#4C9A6A33",
  Azul: "#3D8FCC33",
  Amarelo: "#E3B32433",
  Roxo: "#8C5FC733",
});

export const SUBTYPE_COLORS = Object.freeze({
  ofensiva: "#E14E2B",
  defensiva: "#3D8FCC",
  auxiliar: "#4C9A6A",
  especial: "#8C5FC7",
  "básico": "#8B8F99",
  superior: "#E3B324",
});

export const TYPE_LABEL = Object.freeze({
  "Ação": "Ação",
  "Reação": "Reação",
  "Tática": "Tática",
});

/** Tamanho máximo permitido para o nome de um deck salvo */
export const MAX_DECK_NAME_LENGTH = 80;

/** Mapeamento de cores para IDs de imagem de Drop */
export const DROP_IMAGE_ID = Object.freeze({
  Vermelho: "82",
  Azul: "83",
  Verde: "84",
  Amarelo: "85",
  Roxo: "86",
});
