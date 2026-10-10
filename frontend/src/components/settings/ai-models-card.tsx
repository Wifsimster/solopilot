import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CardFlash, type Flash } from './shared';
import type {
  AiClassView,
  AiEffort,
  AiModelOption,
  AiModelsResponse,
  AiSettingSource,
} from '@/types';

/** Radix Select forbids '' as an item value: sentinels for "no override" and "custom id". */
const DEFAULT = '__default__';
const CUSTOM = '__custom__';
const AUTO = '__auto__';
const MODEL_ID_PATTERN = /^claude-[a-z0-9-]+$/;

const EFFORT_LABELS: Record<AiEffort, string> = {
  low: 'Bas (low)',
  medium: 'Moyen (medium)',
  high: 'Élevé (high)',
  xhigh: 'Très élevé (xhigh)',
  max: 'Maximum (max)',
};

const SOURCE_LABELS: Record<AiSettingSource, string> = {
  settings: 'Paramètres',
  env: "variable d'environnement",
  default: 'défaut',
};

type Tier = 'default' | 'fast';

const CLASSES: {
  tier: Tier;
  title: string;
  help: string;
  modelKey: string;
  effortKey: string;
  autoEffort: string;
}[] = [
  {
    tier: 'default',
    title: 'Modèle principal',
    help: 'Digest de veille, résumé mensuel, rapports du radar, analyse de signaux, studio.',
    modelKey: 'AI_MODEL',
    effortKey: 'AI_EFFORT',
    autoEffort: 'Par tâche (medium pour le studio, high pour les rapports)',
  },
  {
    tier: 'fast',
    title: 'Modèle rapide',
    help: 'Tri horaire des mentions et scoring du radar : le plus gros volume d’appels.',
    modelKey: 'AI_MODEL_FAST',
    effortKey: 'AI_EFFORT_FAST',
    autoEffort: 'Par tâche (low)',
  },
];

interface ClassDraft {
  choice: string;
  custom: string;
  effort: string;
}

function draftFrom(view: AiClassView, catalogue: AiModelOption[]): ClassDraft {
  const inCatalogue = catalogue.some((m) => m.id === view.setting);
  return {
    choice: !view.setting ? DEFAULT : inCatalogue ? view.setting : CUSTOM,
    custom: inCatalogue ? '' : view.setting,
    effort: view.effortSetting || AUTO,
  };
}

/** Effort levels the drafted model accepts (null = unknown custom id: effort not sent). */
function effortLevelsFor(
  draft: ClassDraft,
  view: AiClassView,
  data: AiModelsResponse,
): AiEffort[] | null {
  const id =
    draft.choice === CUSTOM
      ? draft.custom.trim()
      : draft.choice === DEFAULT
        ? view.env || data.defaultModel // no Settings override: env, then code default
        : draft.choice;
  return data.catalogue.find((m) => m.id === id)?.effortLevels ?? null;
}

export function AiModelsCard() {
  const { data, loading, error, refetch } = useApi<AiModelsResponse>('/api/ai/models');
  const [drafts, setDrafts] = useState<Record<Tier, ClassDraft> | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setDrafts({
      default: draftFrom(data.classes.default, data.catalogue),
      fast: draftFrom(data.classes.fast, data.catalogue),
    });
  }, [data]);

  if (loading && !data) return <Skeleton className="h-56 rounded-xl" />;
  if (error || !data || !drafts) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Modèles IA indisponibles : {error ?? 'réponse vide'}</AlertDescription>
      </Alert>
    );
  }

  const update = (tier: Tier, patch: Partial<ClassDraft>) =>
    setDrafts((d) => (d ? { ...d, [tier]: { ...d[tier], ...patch } } : d));

  const invalidCustom = CLASSES.some(
    ({ tier }) =>
      drafts[tier].choice === CUSTOM && !MODEL_ID_PATTERN.test(drafts[tier].custom.trim()),
  );

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (invalidCustom) return;
    const body: Record<string, string> = {};
    for (const { tier, modelKey, effortKey } of CLASSES) {
      const d = drafts[tier];
      body[modelKey] = d.choice === DEFAULT ? '' : d.choice === CUSTOM ? d.custom.trim() : d.choice;
      // No effort for a model without effort levels (or a custom id outside the catalogue).
      const levels = effortLevelsFor(d, data.classes[tier], data);
      body[effortKey] =
        d.effort === AUTO || !levels?.includes(d.effort as AiEffort) ? '' : d.effort;
    }
    setSaving(true);
    setFlash(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { success: boolean; message: string };
      setFlash({
        type: json.success ? 'success' : 'error',
        message: json.success
          ? 'Modèles enregistrés : appliqués dès le prochain appel IA.'
          : json.message,
      });
      if (json.success) refetch();
    } catch {
      setFlash({ type: 'error', message: "Erreur lors de l'enregistrement." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Modèles IA</CardTitle>
        <CardDescription>
          Par défaut, Claude Haiku 5.5 pour toutes les tâches. Ordre de priorité : ces paramètres,
          puis les variables d'environnement (<code className="font-mono text-xs">AI_MODEL</code>,{' '}
          <code className="font-mono text-xs">AI_MODEL_FAST</code>,{' '}
          <code className="font-mono text-xs">AI_EFFORT</code>,{' '}
          <code className="font-mono text-xs">AI_EFFORT_FAST</code>), puis le défaut. Toutes les
          fonctionnalités IA lisent ce choix à chaque appel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <CardFlash flash={flash} />
        {data.provider !== 'anthropic' && (
          <Alert variant="warning">
            <AlertDescription>
              Fournisseur actif : GitHub Models. Ces choix s'appliquent quand le fournisseur
              Anthropic est actif (<code className="font-mono text-xs">ANTHROPIC_API_KEY</code>).
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={save} className="space-y-6">
          {CLASSES.map(({ tier, title, help, autoEffort }) => {
            const view = data.classes[tier];
            const d = drafts[tier];
            const levels = effortLevelsFor(d, view, data);
            const selected = data.catalogue.find((m) => m.id === d.choice);
            const customInvalid = d.choice === CUSTOM && !MODEL_ID_PATTERN.test(d.custom.trim());
            return (
              <fieldset key={tier} className="space-y-3 rounded-lg border p-4">
                <legend className="px-1 text-sm font-semibold">{title}</legend>
                <p className="text-xs text-muted-foreground">{help}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`ai-model-${tier}`}>Modèle</Label>
                    <Select
                      value={d.choice}
                      onValueChange={(v) => {
                        const next = data.catalogue.find((m) => m.id === v);
                        // Drop an effort the new model does not accept.
                        const keep =
                          d.effort === AUTO ||
                          (next?.effortLevels ?? []).includes(d.effort as AiEffort);
                        update(tier, { choice: v, ...(keep ? {} : { effort: AUTO }) });
                      }}
                    >
                      <SelectTrigger id={`ai-model-${tier}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DEFAULT}>
                          Par défaut ({view.env || data.defaultModel})
                        </SelectItem>
                        {data.catalogue.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.label} · {m.priceShort}
                          </SelectItem>
                        ))}
                        <SelectItem value={CUSTOM}>Autre ID…</SelectItem>
                      </SelectContent>
                    </Select>
                    {d.choice === CUSTOM && (
                      <>
                        <Input
                          aria-label={`${title} : identifiant du modèle`}
                          placeholder="claude-..."
                          value={d.custom}
                          onChange={(e) => update(tier, { custom: e.target.value })}
                          aria-invalid={customInvalid}
                        />
                        {customInvalid && (
                          <p className="text-xs text-destructive">
                            Format attendu : claude- suivi de minuscules, chiffres et tirets.
                          </p>
                        )}
                      </>
                    )}
                    {selected && (
                      <p className="text-xs text-muted-foreground">{selected.priceHint}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`ai-effort-${tier}`}>Effort</Label>
                    <Select
                      value={levels ? d.effort : AUTO}
                      disabled={!levels || levels.length === 0}
                      onValueChange={(v) => update(tier, { effort: v })}
                    >
                      <SelectTrigger id={`ai-effort-${tier}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={AUTO}>{autoEffort}</SelectItem>
                        {(levels ?? []).map((level) => (
                          <SelectItem key={level} value={level}>
                            {EFFORT_LABELS[level]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {(!levels || levels.length === 0) && (
                      <p className="text-xs text-muted-foreground">
                        Effort non réglable pour ce modèle : le réglage par tâche s'applique quand
                        le modèle le permet.
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Actuellement : <code className="font-mono">{view.model}</code> (
                  {SOURCE_LABELS[view.modelSource]}), effort{' '}
                  {view.effort
                    ? `${view.effort} (${SOURCE_LABELS[view.effortSource]})`
                    : 'par tâche'}
                  .{!selected && ` ${view.priceHint}.`}
                </p>
              </fieldset>
            );
          })}
          <Button type="submit" disabled={saving || invalidCustom}>
            {saving ? 'Enregistrement...' : 'Enregistrer les modèles'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
