import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import cardBackImage from '../assets/card-back.jpg';
import type { ApiOpenedCard, ApiSealedBooster } from '../lib/api';

interface BoosterOpeningOverlayProps {
  setName: string;
  cards: ApiOpenedCard[];
  onClose: () => void;
  /** Un autre booster du même set attend encore : affiche "Suivant" à côté de "Fermer" une fois la révélation terminée. Absent/omis = aucun booster restant. */
  onNext?: () => void;
  /** Boosters scellés d'AUTRES sets encore disponibles — proposés une fois la révélation terminée, pour ne pas devoir rouvrir le menu principal entre deux sets différents. */
  otherSets?: ApiSealedBooster[];
  onOpenOther?: (setCode: string, setName: string, cardSetId: string | null) => void;
}

type ActivePhase = 'idle' | 'spin' | 'hero' | 'settle';

// Durées (ms) des tours successifs sur une carte, décroissantes : chaque
// carte "tourne" de plus en plus vite avant de se révéler au dernier tour.
// Réservée aux raretés qui déclenchent déjà la grande révélation
// (`is_rare_reveal`, Super Rare et plus, voir boosterOpening.ts côté
// serveur) — la montée en tension a du sens là où il y a un vrai suspense.
const SPIN_DURATIONS = [320, 250, 190, 140, 100];
// Commune/Rare (le gros du booster) : un seul tour suffit avant la
// révélation, pas besoin de la montée en tension complète (retour utilisateur).
const QUICK_SPIN_DURATIONS = [220];
const HERO_HOLD_MS = 1000; // durée de la grande révélation (SR/UR et plus rare)
const SETTLE_MS = 260;
const BETWEEN_CARDS_MS = 150;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function cardImageSrc(card: ApiOpenedCard): string | null {
  return card.card_images[0]?.image_url ?? card.card_images[0]?.image_url_small ?? null;
}

function CardBack() {
  const { t } = useTranslation();
  return (
    <div className="h-full w-full overflow-hidden rounded-lg">
      <img src={cardBackImage} alt={t('duelBoard.card_back_alt')} className="h-full w-full object-cover" />
    </div>
  );
}

function CardFront({ card }: { card: ApiOpenedCard }) {
  const src = cardImageSrc(card);
  if (!src) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-arena-800 p-2 text-center text-[10px] text-neutral-300">
        {card.name}
      </div>
    );
  }
  return <img src={src} alt={card.name} className="h-full w-full object-cover" />;
}

function PendingSlot() {
  return (
    <div className="mx-auto aspect-[59/86] w-full max-w-[140px]">
      <CardBack />
    </div>
  );
}

/** Une fois révélée, la carte grossit au survol pour qu'on puisse relire son texte d'effet — le conteneur grille reste `overflow:visible` (voir plus bas) pour ne pas la tronquer, et le z-index passe devant ses voisines pendant le survol. */
function SettledSlot({ card }: { card: ApiOpenedCard }) {
  return (
    <div
      className={`relative mx-auto aspect-[59/86] w-full max-w-[140px] overflow-hidden rounded-lg transition-transform duration-200 ease-out hover:z-20 hover:scale-[2.5] hover:cursor-zoom-in ${
        card.is_rare_reveal ? 'shadow-[0_0_18px_4px_rgba(244,192,79,0.35)] ring-2 ring-accent-400' : ''
      }`}
    >
      <CardFront card={card} />
    </div>
  );
}

function ActiveSlot({
  card,
  phase,
  squashed,
  faceUp,
  spinHalfMs,
}: {
  card: ApiOpenedCard;
  phase: ActivePhase;
  squashed: boolean;
  faceUp: boolean;
  spinHalfMs: number;
}) {
  const isHero = phase === 'hero';
  const transform = phase === 'spin' ? `scaleX(${squashed ? 0 : 1})` : isHero ? 'scale(2.15)' : 'scale(1)';
  const style =
    phase === 'spin'
      ? { transform, transitionDuration: `${spinHalfMs}ms`, transitionTimingFunction: squashed ? 'ease-in' : 'ease-out' }
      : { transform, transitionDuration: `${SETTLE_MS}ms`, transitionTimingFunction: 'ease-out' };

  return (
    <div className="relative flex items-center justify-center" style={{ zIndex: isHero ? 50 : undefined }}>
      {/* Ce conteneur porte le scale : tout ce qui doit suivre visuellement
          l'agrandissement (halo, étiquette de rareté) est placé DEDANS, pas
          à côté — sinon leur position resterait calée sur la carte non
          agrandie pendant que la carte grossit autour d'eux. */}
      <div className="relative aspect-[59/86] w-full max-w-[140px] transition-transform" style={style}>
        <div
          className={`h-full w-full overflow-hidden rounded-lg ${isHero ? 'animate-[glow-pulse_0.7s_ease-in-out_infinite]' : ''}`}
        >
          {faceUp ? <CardFront card={card} /> : <CardBack />}
          {isHero && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/80 to-transparent [mix-blend-mode:overlay] animate-[shine-sweep_0.9s_ease-in-out_infinite]"
            />
          )}
        </div>
        {isHero && (
          // Contre-échelle (1 / 2.15) : replacée à la bonne taille de texte
          // tout en gardant la position qu'aurait donnée l'agrandissement du
          // parent, donc juste sous la carte agrandie plutôt que dessus.
          <p
            className="absolute left-1/2 top-full mt-2 origin-top whitespace-nowrap text-xs font-semibold uppercase tracking-[0.2em] text-accent-400"
            style={{ transform: 'translateX(-50%) scale(0.4651)' }}
          >
            {card.rarity}
          </p>
        )}
      </div>
    </div>
  );
}

export function BoosterOpeningOverlay({ setName, cards, onClose, onNext, otherSets, onOpenOther }: BoosterOpeningOverlayProps) {
  const { t } = useTranslation();
  const [revealedCount, setRevealedCount] = useState(0);
  const [activePhase, setActivePhase] = useState<ActivePhase>('idle');
  const [squashed, setSquashed] = useState(false);
  const [faceUp, setFaceUp] = useState(false);
  const [spinHalfMs, setSpinHalfMs] = useState(SPIN_DURATIONS[0]! / 2);

  const skipRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    skipRef.current = false;
    // Remet à zéro pour un nouveau lot de cartes (bouton "Suivant" : le même
    // panneau est réutilisé pour le booster suivant plutôt que démonté/
    // remonté) — sans ça, `revealedCount` garderait la valeur du booster
    // précédent et toutes les nouvelles cartes s'afficheraient instantanément
    // "déjà révélées" au lieu de rejouer l'animation.
    setRevealedCount(0);

    const bail = (): boolean => {
      if (cancelledRef.current) return true;
      if (skipRef.current) {
        setActivePhase('idle');
        setRevealedCount(cards.length);
        return true;
      }
      return false;
    };

    async function run() {
      for (let i = 0; i < cards.length; i += 1) {
        const durations = cards[i]!.is_rare_reveal ? SPIN_DURATIONS : QUICK_SPIN_DURATIONS;
        setFaceUp(false);
        setSquashed(false);
        setActivePhase('spin');

        for (let s = 0; s < durations.length; s += 1) {
          const half = durations[s]! / 2;
          setSpinHalfMs(half);
          setSquashed(true);
          await sleep(half);
          if (bail()) return;
          if (s === durations.length - 1) setFaceUp(true);
          setSquashed(false);
          await sleep(half);
          if (bail()) return;
        }

        setFaceUp(true);
        if (cards[i]!.is_rare_reveal) {
          setActivePhase('hero');
          await sleep(HERO_HOLD_MS);
          if (bail()) return;
        }

        setActivePhase('settle');
        await sleep(SETTLE_MS);
        if (bail()) return;

        setRevealedCount(i + 1);
        setActivePhase('idle');
        await sleep(BETWEEN_CARDS_MS);
        if (bail()) return;
      }
    }

    void run();
    return () => {
      cancelledRef.current = true;
    };
  }, [cards]);

  const allDone = revealedCount === cards.length && activePhase === 'idle';

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-black/92 p-6 backdrop-blur-sm">
      <div className="mb-8 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-accent-500">{t('boosterOpening.eyebrow')}</p>
        <h2 className="mt-1 font-display text-2xl text-accent-400">{setName}</h2>
      </div>

      <div className="grid w-full max-w-2xl grid-cols-3 gap-x-4 gap-y-10 [overflow:visible] sm:gap-x-6">
        {cards.map((card, i) => {
          if (i === revealedCount && activePhase !== 'idle') {
            return (
              <ActiveSlot key={i} card={card} phase={activePhase} squashed={squashed} faceUp={faceUp} spinHalfMs={spinHalfMs} />
            );
          }
          if (i < revealedCount) return <SettledSlot key={i} card={card} />;
          return <PendingSlot key={i} />;
        })}
      </div>

      <div className="mt-10 flex items-center gap-4">
        {!allDone && (
          <button
            type="button"
            onClick={() => {
              skipRef.current = true;
            }}
            className="rounded-md border border-arena-600 px-4 py-2 text-sm text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
          >
            {t('boosterOpening.reveal_all')}
          </button>
        )}
        {allDone && onNext && (
          <button
            type="button"
            onClick={onNext}
            className="rounded-md bg-accent-500 px-6 py-2 text-sm font-semibold text-arena-950 transition hover:bg-accent-400"
          >
            {t('boosterOpening.next')}
          </button>
        )}
        {allDone && (
          <button
            type="button"
            onClick={onClose}
            className={
              onNext
                ? 'rounded-md border border-arena-600 px-6 py-2 text-sm text-neutral-300 transition hover:border-accent-500 hover:text-accent-400'
                : 'rounded-md bg-accent-500 px-6 py-2 text-sm font-semibold text-arena-950 transition hover:bg-accent-400'
            }
          >
            {t('characterSheet.close')}
          </button>
        )}
      </div>

      {allDone && otherSets && otherSets.length > 0 && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <p className="text-[11px] uppercase tracking-wide text-neutral-500">{t('boosterOpening.open_another')}</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {otherSets.map((s, index) => (
              // Clé sur card_set_id, pas set_code seul (voir CLAUDE.md — deux
              // entrées peuvent partager le même code) ; repli sur l'index
              // uniquement pour une entrée héritée d'avant ce correctif (card_set_id encore null).
              <button
                key={s.card_set_id ?? `${s.set_code}-${index}`}
                type="button"
                onClick={() => onOpenOther?.(s.set_code, s.set_name, s.card_set_id)}
                className="rounded-md border border-arena-600 px-4 py-1.5 text-xs text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
              >
                {s.set_name} ×{s.quantity}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
