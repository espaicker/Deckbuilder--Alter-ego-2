/**
 * Compartilha um link do site: usa o menu nativo do celular quando existe
 * (navigator.share) e, no computador, copia o endereco.
 *
 * @param {string} path - caminho da pagina (ex.: "/comunidade/decks/12")
 * @param {string} title - titulo mostrado no menu de compartilhamento
 * @param {(msg: string) => void} notify - mostra um aviso ao usuario
 */
export async function shareLink(path, title, notify) {
  const url = new URL(path, window.location.origin).toString();

  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url });
      return;
    } catch (err) {
      // Usuario fechou o menu: nao e erro.
      if (err && err.name === "AbortError") return;
      // Outros erros: tenta copiar.
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    notify("Link copiado.");
  } catch {
    notify(`Não foi possível copiar. Link: ${url}`);
  }
}
