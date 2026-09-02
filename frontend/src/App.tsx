import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { socket } from './lib/socket';
import { useAuth } from './hooks/useAuth';
import { useLanguage } from './hooks/useLanguage';
import { api, type ApiCharacter, type ApiGmNotebook, type ApiSession } from './lib/api';
import { translateApiError } from './lib/translateApiError';
import { AuthPanel } from './components/AuthPanel';
import { SessionPanel } from './components/SessionPanel';
import { CharacterSheetForm } from './components/CharacterSheetForm';
import { CharacterList } from './components/CharacterList';
import { DicePanel } from './components/DicePanel';
import { CardImportPanel } from './components/CardImportPanel';
import { MerchantPanel } from './components/MerchantPanel';
import { DuelPanel } from './components/DuelPanel';
import { CustomCardPanel } from './components/CustomCardPanel';
import { GmNotebookOverlay } from './components/GmNotebookOverlay';

/** Une convocation à un duel reçue en temps réel (voir types/socket.ts duel_invite), pas encore vue/traitée par ce spectateur. */
interface DuelInvite {
  duelId: string;
  duelName: string;
  characterName: string;
}

type Status = 'pending' | 'ok' | 'error';

function StatusDot({ status }: { status: Status }) {
  const color =
    status === 'ok' ? 'bg-emerald-400' : status === 'error' ? 'bg-red-400' : 'bg-amber-400';
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} aria-hidden />;
}

/** Bascule FR/EN — fixe en haut à gauche pour ne pas chevaucher le bouton "🧙 fiche" (fixed right-4 top-4, voir CharacterList.tsx). */
function LanguageToggle() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  return (
    <div
      className="fixed left-4 top-4 z-40 flex overflow-hidden rounded-full border border-arena-600 bg-arena-900/95 text-xs shadow-xl backdrop-blur"
      title={t('common.language_toggle')}
    >
      {(['fr', 'en'] as const).map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => setLanguage(lang)}
          className={`px-3 py-2 font-semibold uppercase transition ${
            language === lang ? 'bg-accent-500 text-arena-950' : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          {lang}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const { t } = useTranslation();
  const auth = useAuth();

  const [session, setSession] = useState<ApiSession | null>(null);
  const [characters, setCharacters] = useState<ApiCharacter[]>([]);
  const [charactersError, setCharactersError] = useState<string | null>(null);

  // Connexion Socket.io de l'app (nécessaire dès le départ : DicePanel,
  // duel_invite, session_resource_changed... en dépendent tous) — les cartes
  // de diagnostic santé API / latence socket qui vivaient ici ont été
  // retirées (pas adapté à un affichage vu par de vrais joueurs), mais la
  // connexion elle-même reste indispensable.
  useEffect(() => {
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, []);

  const fetchCharacters = useCallback(() => {
    if (!auth.token || !session) return;
    setCharactersError(null);
    api
      .listCharacters(auth.token, session.id)
      .then(({ characters: fetched }) => setCharacters(fetched))
      .catch((err) => setCharactersError(translateApiError(err, t)));
  }, [auth.token, session]);

  useEffect(() => {
    if (!auth.token || !session) {
      setCharacters([]);
      return;
    }
    fetchCharacters();
  }, [auth.token, session, fetchCharacters]);

  // Un autre membre du salon (déjà connecté) peut créer/supprimer un
  // personnage (le MJ ajoute un NPC, un joueur qui rejoint crée le sien...) :
  // sans ça, ce changement resterait invisible ici jusqu'à quitter/revenir.
  useEffect(() => {
    if (!session) return;
    const onChanged = (payload: { resource: string; session_id: string }) => {
      if (payload.resource === 'characters' && payload.session_id === session.id) fetchCharacters();
    };
    socket.on('session_resource_changed', onChanged);
    return () => {
      socket.off('session_resource_changed', onChanged);
    };
  }, [session, fetchCharacters]);

  // Convocation temps réel à un duel créé par le MJ (voir types/socket.ts
  // duel_invite) : diffusé à tout le salon, mais on ne retient QUE les
  // convocations où notre propre user_id figure dans `participants` (les PNJ
  // et le MJ créateur ne génèrent jamais d'entrée pour eux-mêmes côté
  // serveur, donc pas besoin de re-filtrer ça ici, juste de savoir si NOUS y
  // sommes). Dédupliqué par duel_id : un double envoi ne doit pas empiler
  // deux bannières identiques.
  const [duelInvites, setDuelInvites] = useState<DuelInvite[]>([]);
  const [requestedOpenDuelId, setRequestedOpenDuelId] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !auth.user) return;
    const onInvite = (payload: {
      session_id: string;
      duel_id: string;
      duel_name: string;
      participants: Array<{ user_id: string; character_id: string; character_name: string; team: 0 | 1 }>;
    }) => {
      if (payload.session_id !== session.id) return;
      const mine = payload.participants.find((p) => p.user_id === auth.user!.id);
      if (!mine) return;
      setDuelInvites((prev) => (prev.some((i) => i.duelId === payload.duel_id) ? prev : [...prev, { duelId: payload.duel_id, duelName: payload.duel_name, characterName: mine.character_name }]));
    };
    socket.on('duel_invite', onInvite);
    return () => {
      socket.off('duel_invite', onInvite);
    };
  }, [session, auth.user]);

  const dismissDuelInvite = (duelId: string) => setDuelInvites((prev) => prev.filter((i) => i.duelId !== duelId));
  const openDuelInvite = (duelId: string) => {
    setRequestedOpenDuelId(duelId);
    dismissDuelInvite(duelId);
  };

  const handleCharacterCreated = (character: ApiCharacter) => {
    setCharacters((prev) => [...prev, character]);
  };

  const handleCharacterDelete = async (characterId: string) => {
    if (!auth.token) return;
    try {
      await api.deleteCharacter(auth.token, characterId);
      setCharacters((prev) => prev.filter((c) => c.id !== characterId));
    } catch (err) {
      setCharactersError(translateApiError(err, t));
    }
  };

  const handleCharacterRerollsChange = (characterId: string, remaining: number) => {
    setCharacters((prev) => prev.map((c) => (c.id === characterId ? { ...c, remaining_luck_rerolls: remaining } : c)));
  };

  const handleCharacterUpdate = (
    characterId: string,
    patch: Partial<
      Pick<ApiCharacter, 'money' | 'collection' | 'sealed_boosters' | 'decks' | 'name' | 'backstory' | 'personality' | 'visual_description' | 'notes' | 'inventory'>
    >,
  ) => {
    setCharacters((prev) => prev.map((c) => (c.id === characterId ? { ...c, ...patch } : c)));
  };

  // "Long repos" (demande utilisateur) : le MJ recharge en une action les
  // rerolls de Chance de tout le salon plutôt qu'un par un — voir
  // characterRouter POST /session/:sessionId/long-rest.
  const [longResting, setLongResting] = useState(false);
  const handleLongRest = async () => {
    if (!auth.token || !session) return;
    setLongResting(true);
    try {
      const { characters: rested } = await api.longRestSession(auth.token, session.id);
      setCharacters(rested);
    } catch (err) {
      setCharactersError(translateApiError(err, t));
    } finally {
      setLongResting(false);
    }
  };

  // Carnet du MJ (demande utilisateur) : même emplacement flottant que le
  // bouton "🧙 fiche" du joueur (CharacterList.tsx) — jamais de collision
  // possible, le MJ ne possède jamais de personnage joueur (voir la règle
  // "un seul personnage joueur par utilisateur", CLAUDE.md).
  const [gmNotebookOpen, setGmNotebookOpen] = useState(false);
  const handleGmNotebookUpdate = (notebook: ApiGmNotebook) => {
    setSession((prev) => (prev ? { ...prev, gm_notebook: notebook } : prev));
  };

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <LanguageToggle />

      {session?.is_gm && (
        <button
          type="button"
          onClick={() => setGmNotebookOpen(true)}
          className="fixed right-4 top-4 z-40 flex items-center gap-2 rounded-full border border-accent-500 bg-arena-900/95 px-4 py-2 text-sm font-semibold text-accent-400 shadow-xl backdrop-blur transition hover:bg-accent-500 hover:text-arena-950"
        >
          {t('app.gm_notebook_button')}
        </button>
      )}

      {gmNotebookOpen && auth.token && session?.gm_notebook && (
        <GmNotebookOverlay
          token={auth.token}
          sessionCode={session.code}
          notebook={session.gm_notebook}
          onNotebookUpdate={handleGmNotebookUpdate}
          onClose={() => setGmNotebookOpen(false)}
        />
      )}

      {duelInvites.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
          {duelInvites.map((invite) => (
            <div
              key={invite.duelId}
              className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-accent-500 bg-arena-900 p-3 text-sm shadow-xl"
            >
              <span className="text-lg" aria-hidden>
                ⚔️
              </span>
              <p className="flex-1 text-neutral-200">
                {t('app.duel_invite_prefix')} <span className="font-semibold text-accent-400">{invite.duelName}</span>{' '}
                {t('app.duel_invite_character', { character: invite.characterName })}
              </p>
              <button
                type="button"
                onClick={() => openDuelInvite(invite.duelId)}
                className="shrink-0 rounded-md bg-accent-500 px-2.5 py-1 text-xs font-semibold text-arena-950 transition hover:bg-accent-400"
              >
                {t('app.view_duel')}
              </button>
              <button
                type="button"
                onClick={() => dismissDuelInvite(invite.duelId)}
                className="shrink-0 text-neutral-400 hover:text-neutral-200"
                aria-label={t('app.dismiss')}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <header className="text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-accent-500">{t('app.eyebrow')}</p>
        <h1 className="mt-2 text-4xl font-bold text-accent-400">Yu-Gi-Oh! D&amp;D</h1>
        <p className="mt-3 text-sm text-neutral-400">{t('app.subtitle')}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {auth.loading ? (
          <p className="text-center text-sm text-neutral-500">{t('app.checking_session')}</p>
        ) : auth.user && auth.token ? (
          <>
            <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
              <header className="mb-3 flex items-center gap-2">
                <StatusDot status="ok" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-200">{t('app.account_title')}</h2>
              </header>
              <div className="space-y-1 font-mono text-sm text-neutral-300">
                <p>
                  {t('app.username_label')} {auth.user.username}
                </p>
                <p>
                  {t('app.email_label')} {auth.user.email}
                </p>
                <p>
                  {t('app.role_label')} {auth.user.role}
                </p>
              </div>
              <button
                type="button"
                onClick={auth.logout}
                className="mt-3 rounded-md border border-arena-600 px-3 py-1.5 text-xs text-neutral-200 transition hover:border-red-400 hover:text-red-400"
              >
                {t('app.logout')}
              </button>
            </section>
            <SessionPanel token={auth.token} session={session} onSessionChange={setSession} />
          </>
        ) : (
          <div className="sm:col-span-2 sm:mx-auto sm:w-full sm:max-w-sm">
            <AuthPanel
              onLogin={auth.login}
              onRegister={auth.register}
              onVerifyRegistration={auth.verifyRegistration}
              onForgotPassword={auth.forgotPassword}
              onResetPassword={auth.resetPassword}
            />
          </div>
        )}
      </div>

      {auth.user && auth.token && session && (
        <div className="grid gap-4 sm:grid-cols-2">
          <CharacterSheetForm
            token={auth.token}
            sessionId={session.id}
            isGm={session.is_gm}
            hasPlayerCharacter={characters.some((c) => !c.is_npc && c.user_id === auth.user!.id)}
            onCreated={handleCharacterCreated}
          />
          <div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-200">{t('app.session_characters_title')}</h2>
              {session.is_gm && characters.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleLongRest()}
                  disabled={longResting}
                  title={t('app.long_rest_tooltip')}
                  className="shrink-0 rounded-md border border-accent-500 px-2.5 py-1 text-xs text-accent-400 transition hover:bg-accent-500 hover:text-arena-950 disabled:opacity-50"
                >
                  {longResting ? t('app.long_rest_in_progress') : t('app.long_rest_button')}
                </button>
              )}
            </div>
            {charactersError && <p className="mb-2 text-xs text-red-400">{charactersError}</p>}
            <CharacterList
              token={auth.token}
              characters={characters}
              currentUserId={auth.user.id}
              isGm={session.is_gm}
              currencyName={session.currency_name}
              onDelete={(id) => void handleCharacterDelete(id)}
              onCharacterUpdate={handleCharacterUpdate}
            />
          </div>
        </div>
      )}

      {auth.user && auth.token && session && (
        <DicePanel
          token={auth.token}
          session={session}
          characters={characters}
          currentUserId={auth.user.id}
          onCharacterRerollsChange={handleCharacterRerollsChange}
        />
      )}

      {auth.user && auth.token && session && (
        <MerchantPanel
          token={auth.token}
          sessionId={session.id}
          currencyName={session.currency_name}
          isGm={session.is_gm}
          characters={characters}
          currentUserId={auth.user.id}
          onCharacterUpdate={handleCharacterUpdate}
        />
      )}

      {auth.user && auth.token && session && (
        <DuelPanel
          token={auth.token}
          session={session}
          characters={characters}
          currentUserId={auth.user.id}
          requestedOpenDuelId={requestedOpenDuelId}
          onRequestedOpenDuelHandled={() => setRequestedOpenDuelId(null)}
        />
      )}

      {auth.user && auth.token && session && (
        <CustomCardPanel token={auth.token} sessionId={session.id} isGm={session.is_gm} />
      )}

      {auth.user && auth.token && <CardImportPanel token={auth.token} />}
    </main>
  );
}
