import { api } from "../lib/api.js";
import { useState } from "react";

const CONTACT_EMAIL = "privacidade@forjadealteregos.com.br";

/* ============================================================
   POLITICA DE PRIVACIDADE
   ============================================================ */
function PrivacyContent() {
  return (
    <>
      <h1 className="ab-section-title">Política de Privacidade</h1>
      <p className="ab-section-sub">
        Esta política explica quais dados a Forja de Alter Egos coleta, por que,
        por quanto tempo e quais são os seus direitos. Ela segue a Lei Geral de
        Proteção de Dados (LGPD, Lei 13.709/2018).
      </p>

      <h2 className="ab-legal-h2">1. Quais dados coletamos</h2>
      <ul className="ab-legal-list">
        <li><strong>Nome de usuário:</strong> escolhido por você, exibido publicamente em decks, torneios e fórum.</li>
        <li><strong>E-mail:</strong> usado para login, recuperação de senha e comunicações da conta. Nunca é exibido publicamente.</li>
        <li><strong>Senha:</strong> armazenada apenas como hash (bcrypt) — não guardamos sua senha em texto legível.</li>
        <li><strong>Conteúdo que você cria:</strong> decks, posts de fórum, inscrições e resultados de torneio.</li>
        <li><strong>Dados de loja (opcional):</strong> se você cadastrar uma loja parceira, o contato público que você mesmo informar.</li>
      </ul>

      <h2 className="ab-legal-h2">2. Por que coletamos</h2>
      <p className="ab-legal-p">
        Para permitir login, funcionamento de torneios e ranking, publicação de
        decks, participação no fórum e recuperação de conta. Não usamos seus
        dados para publicidade nem criamos perfis para venda.
      </p>

      <h2 className="ab-legal-h2">3. Por quanto tempo guardamos</h2>
      <p className="ab-legal-p">
        Enquanto sua conta existir. Contas inativas por longos períodos podem ser
        removidas conforme a política de retenção (ver documentação de deploy do
        projeto). Você pode apagar sua conta a qualquer momento (seção 6).
      </p>

      <h2 className="ab-legal-h2">4. Com quem compartilhamos</h2>
      <p className="ab-legal-p">
        <strong>Com ninguém.</strong> Não vendemos, alugamos nem compartilhamos
        seus dados pessoais com terceiros. O único envio externo é o e-mail de
        recuperação de senha, entregue apenas a você, pelo provedor de e-mail.
      </p>

      <h2 className="ab-legal-h2">5. Direito de acesso e portabilidade</h2>
      <p className="ab-legal-p">
        Você pode baixar todos os seus dados pessoais em formato JSON a qualquer
        momento, na tela do seu perfil ("Baixar meus dados").
      </p>

      <h2 className="ab-legal-h2">6. Direito ao esquecimento (apagar conta)</h2>
      <p className="ab-legal-p">
        Você pode apagar sua conta na tela de perfil. Ao fazer isso, seu e-mail e
        senha são removidos e seu nome de usuário é substituído por um
        identificador anônimo ("Usuário removido #ID"). Dados de histórico
        competitivo (resultados de partidas, decks usados em torneios) são
        <strong> anonimizados</strong> em vez de apagados linha a linha, porque
        fazem parte do histórico de ranking de outros jogadores — apagá-los
        quebraria a integridade dos resultados alheios. Depois da anonimização,
        esse histórico não é mais rastreável a você.
      </p>

      <h2 className="ab-legal-h2">7. Segurança</h2>
      <p className="ab-legal-p">
        Senhas são armazenadas com hash bcrypt, tokens de recuperação são
        guardados apenas como hash, e as rotas sensíveis exigem autenticação e
        têm limite de tentativas contra abuso.
      </p>

      <h2 className="ab-legal-h2">8. Contato</h2>
      <p className="ab-legal-p">
        Dúvidas sobre seus dados? Fale com a gente: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
      <p className="ab-legal-note">
        Este documento é a base do projeto e não substitui aconselhamento
        jurídico profissional.
      </p>
    </>
  );
}

/* ============================================================
   TERMOS DE USO
   ============================================================ */
function TermsContent() {
  return (
    <>
      <h1 className="ab-section-title">Termos de Uso</h1>
      <p className="ab-section-sub">
        Ao criar uma conta e usar a Forja de Alter Egos, você concorda com estes termos.
      </p>

      <h2 className="ab-legal-h2">1. Sobre o serviço</h2>
      <p className="ab-legal-p">
        A Forja de Alter Egos é uma plataforma comunitária para construção de
        decks, organização de torneios, ranking e discussão sobre o card game.
      </p>

      <h2 className="ab-legal-h2">2. Sua conta</h2>
      <ul className="ab-legal-list">
        <li>Você é responsável por manter sua senha segura.</li>
        <li>Um e-mail válido é necessário para recuperar o acesso.</li>
        <li>Não crie contas para se passar por outra pessoa.</li>
      </ul>

      <h2 className="ab-legal-h2">3. Conduta</h2>
      <p className="ab-legal-p">
        Conteúdo que você publica (decks, posts de fórum) deve respeitar os
        demais usuários. Conteúdo abusivo, ilegal ou spam pode ser removido e a
        conta suspensa. O fórum tem moderação.
      </p>

      <h2 className="ab-legal-h2">4. Torneios e ranking</h2>
      <p className="ab-legal-p">
        Resultados de torneio compõem o ranking da comunidade. Para preservar a
        integridade competitiva, resultados já registrados são mantidos mesmo
        que uma conta seja apagada (de forma anonimizada).
      </p>

      <h2 className="ab-legal-h2">5. Seus dados</h2>
      <p className="ab-legal-p">
        O tratamento dos seus dados pessoais segue a{" "}
        <a href="/privacidade">Política de Privacidade</a>. Você pode exportar ou
        apagar seus dados a qualquer momento.
      </p>

      <h2 className="ab-legal-h2">6. Alterações</h2>
      <p className="ab-legal-p">
        Estes termos podem ser atualizados. Mudanças relevantes serão comunicadas
        na plataforma.
      </p>

      <p className="ab-legal-note">
        Este documento é a base do projeto e não substitui aconselhamento
        jurídico profissional.
      </p>
    </>
  );
}

/* ============================================================
   CONFIGURACOES DE CONTA (LGPD): exportar / apagar
   ============================================================ */
export function AccountDataSettings({ user, flashToast, onDeleted }) {
  const [exporting, setExporting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const data = await api.exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `meus-dados-${user?.username || "conta"}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      flashToast("Seus dados foram exportados.");
    } catch (err) {
      flashToast(err.message);
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete(e) {
    e.preventDefault();
    setDeleting(true);
    try {
      await api.deleteMyAccount(password);
      flashToast("Conta apagada. Seus dados pessoais foram removidos.");
      if (onDeleted) onDeleted();
    } catch (err) {
      flashToast(err.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="ab-account-data">
      <div className="ab-sidebar-group-title">Meus dados (LGPD)</div>
      <p className="ab-legal-p">
        Você tem direito de acessar e apagar seus dados pessoais a qualquer momento.
      </p>
      <div className="ab-publish-actions">
        <button className="ab-btn ab-btn-primary" onClick={handleExport} disabled={exporting}>
          {exporting ? "Preparando…" : "Baixar meus dados"}
        </button>
        <button className="ab-btn ab-btn-ghost ab-btn-danger" onClick={() => setShowDelete((v) => !v)}>
          Apagar minha conta
        </button>
      </div>

      {showDelete && (
        <form className="ab-auth-form" onSubmit={handleDelete} style={{ marginTop: "12px" }}>
          <p className="ab-legal-p">
            Isso remove seu e-mail e senha e anonimiza seu histórico. Não pode ser
            desfeito. Confirme com sua senha atual:
          </p>
          <label className="ab-auth-label">
            Senha atual
            <input
              className="ab-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button className="ab-btn ab-btn-danger" type="submit" disabled={deleting || !password}>
            {deleting ? "Apagando…" : "Confirmar exclusão da conta"}
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * Pagina estatica de conteudo legal. variant = "privacy" | "terms".
 */
export default function LegalPage({ variant, onBack }) {
  return (
    <section className="ab-section ab-legal-page">
      {onBack && <button className="ab-btn ab-btn-ghost" onClick={onBack}>← Voltar</button>}
      {variant === "terms" ? <TermsContent /> : <PrivacyContent />}
    </section>
  );
}
