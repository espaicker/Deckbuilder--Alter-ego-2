import { createContext, useContext, useEffect, useState } from "react";
import BUNDLED_CARD_DATA from "../data/modelo_cartas.json";
import { fetchCardData } from "../lib/cardDataSource.js";

/**
 * Dados das cartas para o app inteiro. Comeca com o JSON embutido no build e,
 * na montagem, busca GET /api/cards uma vez (dados atuais, inclusive cartas
 * criadas/editadas pelo admin depois do build). Se a API falhar, continua com
 * o JSON embutido.
 */
const CardDataContext = createContext({ cardData: BUNDLED_CARD_DATA, loaded: true });

export function CardDataProvider({ children }) {
  const [state, setState] = useState({ cardData: BUNDLED_CARD_DATA, loaded: false });

  useEffect(() => {
    let cancelled = false;
    fetchCardData({ fallback: BUNDLED_CARD_DATA }).then(({ data, source }) => {
      if (cancelled) return;
      if (source !== "api") console.warn("[cartas] API indisponivel; usando os dados de cartas do build.");
      setState({ cardData: data, loaded: true });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <CardDataContext.Provider value={state}>{children}</CardDataContext.Provider>;
}

/** @returns {{ cardData: object, loaded: boolean }} */
export function useCardData() {
  return useContext(CardDataContext);
}
