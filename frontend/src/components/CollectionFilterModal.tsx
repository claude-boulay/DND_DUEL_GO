import {
  ABILITY_OPTIONS,
  ATTRIBUTE_OPTIONS,
  CATEGORY_OPTIONS,
  EMPTY_FILTERS,
  MONSTER_KIND_OPTIONS,
  SPELL_RACE_OPTIONS,
  TRAP_RACE_OPTIONS,
  toggleInArray,
  type CardCategory,
  type CollectionFilters,
} from '../lib/cardFilters';

interface CollectionFilterModalProps {
  filters: CollectionFilters;
  onChange: (filters: CollectionFilters) => void;
  onClose: () => void;
  availableRaces: string[];
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-400">{title}</h4>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition ${
        active ? 'border-accent-500 bg-accent-500 text-arena-950' : 'border-arena-600 text-neutral-300 hover:border-accent-500 hover:text-accent-400'
      }`}
    >
      {label}
    </button>
  );
}

export function CollectionFilterModal({ filters, onChange, onClose, availableRaces }: CollectionFilterModalProps) {
  const set = (patch: Partial<CollectionFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-arena-700 bg-arena-900 p-5 text-sm text-neutral-100 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg text-accent-400">Filtrer les cartes</h3>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-200">
            ✕
          </button>
        </div>

        <FilterSection title="Catégorie">
          {CATEGORY_OPTIONS.map((opt) => (
            <FilterChip
              key={opt.value}
              label={opt.label}
              active={filters.categories.includes(opt.value)}
              onClick={() => set({ categories: toggleInArray<CardCategory>(filters.categories, opt.value) })}
            />
          ))}
        </FilterSection>

        <FilterSection title="Type de monstre">
          {MONSTER_KIND_OPTIONS.map((opt) => (
            <FilterChip
              key={opt.value}
              label={opt.label}
              active={filters.monsterKinds.includes(opt.value)}
              onClick={() => set({ monsterKinds: toggleInArray(filters.monsterKinds, opt.value) })}
            />
          ))}
          <FilterChip label="Pendule uniquement" active={filters.pendulumOnly} onClick={() => set({ pendulumOnly: !filters.pendulumOnly })} />
        </FilterSection>

        <FilterSection title="Capacité (monstre)">
          {ABILITY_OPTIONS.map((opt) => (
            <FilterChip
              key={opt.value}
              label={opt.label}
              active={filters.abilities.includes(opt.value)}
              onClick={() => set({ abilities: toggleInArray(filters.abilities, opt.value) })}
            />
          ))}
        </FilterSection>

        <div className="mb-4 flex gap-4">
          <div className="flex-1">
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-400">ATK</h4>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                placeholder="min"
                value={filters.atkMin ?? ''}
                onChange={(e) => set({ atkMin: e.target.value === '' ? null : Number(e.target.value) })}
                className="w-full min-w-0 rounded border border-arena-600 bg-arena-800 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-accent-500"
              />
              <span className="text-neutral-500">–</span>
              <input
                type="number"
                min={0}
                placeholder="max"
                value={filters.atkMax ?? ''}
                onChange={(e) => set({ atkMax: e.target.value === '' ? null : Number(e.target.value) })}
                className="w-full min-w-0 rounded border border-arena-600 bg-arena-800 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-accent-500"
              />
            </div>
          </div>
          <div className="flex-1">
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-400">Niveau / Rang</h4>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                placeholder="min"
                value={filters.levelMin ?? ''}
                onChange={(e) => set({ levelMin: e.target.value === '' ? null : Number(e.target.value) })}
                className="w-full min-w-0 rounded border border-arena-600 bg-arena-800 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-accent-500"
              />
              <span className="text-neutral-500">–</span>
              <input
                type="number"
                min={0}
                placeholder="max"
                value={filters.levelMax ?? ''}
                onChange={(e) => set({ levelMax: e.target.value === '' ? null : Number(e.target.value) })}
                className="w-full min-w-0 rounded border border-arena-600 bg-arena-800 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-accent-500"
              />
            </div>
          </div>
        </div>

        <FilterSection title="Type de magie">
          {SPELL_RACE_OPTIONS.map((opt) => (
            <FilterChip
              key={opt.value}
              label={opt.label}
              active={filters.spellTypes.includes(opt.value)}
              onClick={() => set({ spellTypes: toggleInArray(filters.spellTypes, opt.value) })}
            />
          ))}
        </FilterSection>

        <FilterSection title="Type de piège">
          {TRAP_RACE_OPTIONS.map((opt) => (
            <FilterChip
              key={opt.value}
              label={opt.label}
              active={filters.trapTypes.includes(opt.value)}
              onClick={() => set({ trapTypes: toggleInArray(filters.trapTypes, opt.value) })}
            />
          ))}
        </FilterSection>

        <FilterSection title="Attribut">
          {ATTRIBUTE_OPTIONS.map((attr) => (
            <FilterChip
              key={attr}
              label={attr}
              active={filters.attributes.includes(attr)}
              onClick={() => set({ attributes: toggleInArray(filters.attributes, attr) })}
            />
          ))}
        </FilterSection>

        {availableRaces.length > 0 && (
          <FilterSection title="Race (monstre)">
            {availableRaces.map((race) => (
              <FilterChip
                key={race}
                label={race}
                active={filters.races.includes(race)}
                onClick={() => set({ races: toggleInArray(filters.races, race) })}
              />
            ))}
          </FilterSection>
        )}

        <div className="mt-4 flex justify-between border-t border-arena-700 pt-3">
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="rounded-md border border-arena-600 px-3 py-1.5 text-neutral-300 transition hover:border-red-400 hover:text-red-400"
          >
            Réinitialiser
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-accent-500 px-4 py-1.5 font-semibold text-arena-950 transition hover:bg-accent-400"
          >
            Appliquer
          </button>
        </div>
      </div>
    </div>
  );
}
