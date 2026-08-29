import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { socket } from './lib/socket';
import { useAuth } from './hooks/useAuth';
import { api, ApiError, type ApiCharacter, type ApiDeck, type ApiSealedBooster, type ApiSession } from './lib/api';
import { AuthPanel } from './components/AuthPanel';
import { SessionPanel } from './components/SessionPanel';
import { CharacterSheetForm } from './components/CharacterSheetForm';
import { CharacterList } from './components/CharacterList';
import { DicePanel } from './components/DicePanel';
import { CardImportPanel } from './components/CardImportPanel';
import { MerchantPanel } from './components/MerchantPanel';
import { DuelPanel } from './components/DuelPanel';
import { CustomCardPanel } from './components/CustomCardPanel';

interface HealthResponse {
  status: string;
  service: string;
  env: string;
  database: string;
  uptime_seconds: number;
  server_time: string;
}

type Status = 'pending' | 'ok' | 'error';

function StatusDot({ status }: { status: Status }) {
  const color =
    status === 'ok' ? 'bg-emerald-400' : status === 'error' ? 'bg-red-400' : 'bg-amber-400';
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} aria-hidden />;
}

function Card({
  title,
  status,
  children,
}: {
  title: string;
  status: Status;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
      <header className="mb-3 flex items-center gap-2">
        <StatusDot status={status} />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-200">{title}</h2>
      </header>
      <div className="space-y-1 font-mono text-sm text-neutral-300">{children}</div>
    </section>
  );
}

export default function App() {
  const auth = useAuth();

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthStatus, setHealthStatus] = useState<Status>('pending');
  const [healthError, setHealthError] = useState<string | null>(null);

  const [socketId, setSocketId] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const [session, setSession] = useState<ApiSession | null>(null);
  const [characters, setCharacters] = useState<ApiCharacter[]>([]);
  const [charactersError, setCharactersError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setHealthStatus('pending');
    try {
      const response = await fetch('/api/health');
      const data = (await response.json()) as HealthResponse;
      setHealth(data);
      setHealthStatus(response.ok ? 'ok' : 'error');
      setHealthError(response.ok ? null : `HTTP ${response.status}`);
    } catch (error) {
      setHealthStatus('error');
      setHealthError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void fetchHealth();
  }, [fetchHealth]);

  useEffect(() => {
    const onHello = (payload: { socket_id: string }) => setSocketId(payload.socket_id);
    const onPong = (payload: { sent_at: number }) => setLatencyMs(Date.now() - payload.sent_at);
    const onDisconnect = () => {
      setSocketId(null);
      setLatencyMs(null);
    };

    socket.on('server_hello', onHello);
    socket.on('pong_server', onPong);
    socket.on('disconnect', onDisconnect);
    socket.connect();

    return () => {
      socket.off('server_hello', onHello);
      socket.off('pong_server', onPong);
      socket.off('disconnect', onDisconnect);
      socket.disconnect();
    };
  }, []);

  const sendPing = () => socket.emit('ping_server', { sent_at: Date.now() });

  const fetchCharacters = useCallback(() => {
    if (!auth.token || !session) return;
    setCharactersError(null);
    api
      .listCharacters(auth.token, session.id)
      .then(({ characters: fetched }) => setCharacters(fetched))
      .catch((err) => setCharactersError(err instanceof ApiError ? err.message : 'Une erreur est survenue'));
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

  const handleCharacterCreated = (character: ApiCharacter) => {
    setCharacters((prev) => [...prev, character]);
  };

  const handleCharacterDelete = async (characterId: string) => {
    if (!auth.token) return;
    try {
      await api.deleteCharacter(auth.token, characterId);
      setCharacters((prev) => prev.filter((c) => c.id !== characterId));
    } catch (err) {
      setCharactersError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    }
  };

  const handleCharacterRerollsChange = (characterId: string, remaining: number) => {
    setCharacters((prev) => prev.map((c) => (c.id === characterId ? { ...c, remaining_luck_rerolls: remaining } : c)));
  };

  const handleCharacterUpdate = (
    characterId: string,
    patch: { money?: number; collection?: string[]; sealed_boosters?: ApiSealedBooster[]; decks?: ApiDeck[] },
  ) => {
    setCharacters((prev) => prev.map((c) => (c.id === characterId ? { ...c, ...patch } : c)));
  };

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <header className="text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-accent-500">Plateforme JDR</p>
        <h1 className="mt-2 text-4xl font-bold text-accent-400">Yu-Gi-Oh! D&amp;D</h1>
        <p className="mt-3 text-sm text-neutral-400">
          Socle technique en place. Vérification de bout en bout de la stack.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="API & Base de données" status={healthStatus}>
          {health ? (
            <>
              <p>statut : {health.status}</p>
              <p>mongodb : {health.database}</p>
              <p>env : {health.env}</p>
              <p>uptime : {health.uptime_seconds}s</p>
            </>
          ) : (
            <p>{healthError ?? 'Interrogation du backend...'}</p>
          )}
          <button
            type="button"
            onClick={() => void fetchHealth()}
            className="mt-3 rounded-md border border-arena-600 px-3 py-1.5 text-xs text-neutral-200 transition hover:border-accent-500 hover:text-accent-400"
          >
            Rafraîchir
          </button>
        </Card>

        <Card title="Temps réel (Socket.io)" status={socketId ? 'ok' : 'pending'}>
          <p>socket : {socketId ?? 'connexion...'}</p>
          <p>latence : {latencyMs === null ? '—' : `${latencyMs} ms`}</p>
          <button
            type="button"
            onClick={sendPing}
            disabled={!socketId}
            className="mt-3 rounded-md border border-arena-600 px-3 py-1.5 text-xs text-neutral-200 transition hover:border-accent-500 hover:text-accent-400 disabled:opacity-40"
          >
            Envoyer un ping
          </button>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {auth.loading ? (
          <p className="text-center text-sm text-neutral-500">Vérification de la session...</p>
        ) : auth.user && auth.token ? (
          <>
            <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
              <header className="mb-3 flex items-center gap-2">
                <StatusDot status="ok" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-200">Compte</h2>
              </header>
              <div className="space-y-1 font-mono text-sm text-neutral-300">
                <p>utilisateur : {auth.user.username}</p>
                <p>email : {auth.user.email}</p>
                <p>rôle : {auth.user.role}</p>
              </div>
              <button
                type="button"
                onClick={auth.logout}
                className="mt-3 rounded-md border border-arena-600 px-3 py-1.5 text-xs text-neutral-200 transition hover:border-red-400 hover:text-red-400"
              >
                Se déconnecter
              </button>
            </section>
            <SessionPanel token={auth.token} session={session} onSessionChange={setSession} />
          </>
        ) : (
          <div className="sm:col-span-2 sm:mx-auto sm:w-full sm:max-w-sm">
            <AuthPanel onLogin={auth.login} onRegister={auth.register} />
          </div>
        )}
      </div>

      {auth.user && auth.token && session && (
        <div className="grid gap-4 sm:grid-cols-2">
          <CharacterSheetForm
            token={auth.token}
            sessionId={session.id}
            canCreateNpc={session.is_gm}
            onCreated={handleCharacterCreated}
          />
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-200">Personnages du salon</h2>
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
        <DuelPanel token={auth.token} session={session} characters={characters} currentUserId={auth.user.id} />
      )}

      {auth.user && auth.token && session && (
        <CustomCardPanel token={auth.token} sessionId={session.id} isGm={session.is_gm} />
      )}

      {auth.user && auth.token && <CardImportPanel token={auth.token} />}

      <footer className="text-center text-xs text-neutral-500">
        Prochaine étape : peaufinage de l'interface de duel multi-PNJ.
      </footer>
    </main>
  );
}
