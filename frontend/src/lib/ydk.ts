import type { ApiDeckCardEntry, ApiDeckDetail } from './api';

/**
 * Export d'un deck au format YDK (demande utilisateur — "si jamais on veut
 * l'utiliser sur un autre émulateur"). Format standard EDOPro/YGOPro : un
 * passcode par ligne, sous `#main`/`#extra`/`!side` — `!side` reste toujours
 * vide, cette app n'a pas de notion de side deck. `engine_code` (voir
 * Card.model.ts) EST le passcode moteur attendu ici : identique à
 * `ygoprodeck_id` pour une carte officielle, synthétique pour une carte
 * custom — donc valable pour les deux sans distinction.
 */
function passcodesFor(entries: ApiDeckCardEntry[]): number[] {
  const codes: number[] = [];
  for (const entry of entries) {
    const code = entry.card.engine_code ?? entry.card.ygoprodeck_id;
    if (code === null) continue; // ne devrait pas arriver (passcode obligatoire pour toute carte jouable), ignoré plutôt que de casser l'export
    for (let i = 0; i < entry.quantity; i++) codes.push(code);
  }
  return codes;
}

export function buildYdkContent(deck: ApiDeckDetail): string {
  const lines = [
    `#created by DND Duel GO`,
    `#${deck.name}`,
    '#main',
    ...passcodesFor(deck.main).map(String),
    '#extra',
    ...passcodesFor(deck.extra).map(String),
    '!side',
  ];
  return lines.join('\n') + '\n';
}

/** Déclenche le téléchargement du fichier .ydk dans le navigateur. */
export function downloadYdk(deck: ApiDeckDetail): void {
  const content = buildYdkContent(deck);
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${deck.name.replace(/[^a-z0-9_-]+/gi, '_') || 'deck'}.ydk`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
