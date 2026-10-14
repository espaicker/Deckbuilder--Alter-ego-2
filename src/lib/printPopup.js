/**
 * Dispara a impressao de um pop-up (window.open("", "_blank") +
 * document.write) quando todas as imagens terminarem de carregar.
 *
 * Roda a partir da janela que abriu o pop-up: o documento about:blank herda a
 * Content-Security-Policy do site (script-src 'self'), entao um <script>
 * inline escrito no pop-up seria bloqueado. Chame depois de document.close().
 */
export function printWhenImagesLoaded(popup, delayMs = 150) {
  if (!popup || popup.closed) return;
  const doc = popup.document;
  // Timers do proprio pop-up: a aba de quem abriu fica em segundo plano e
  // pode ter os timers atrasados pelo navegador.
  const later = typeof popup.setTimeout === "function" ? popup.setTimeout.bind(popup) : setTimeout;

  const imagesLoaded = () =>
    Promise.all(
      Array.from(doc.images || []).map((image) =>
        image.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", resolve, { once: true });
            })
      )
    );

  const printNow = () => {
    imagesLoaded().then(() =>
      later(() => {
        if (popup.closed) return;
        popup.focus();
        popup.print();
      }, delayMs)
    );
  };

  if (doc.readyState === "complete") printNow();
  else popup.addEventListener("load", printNow, { once: true });
}
