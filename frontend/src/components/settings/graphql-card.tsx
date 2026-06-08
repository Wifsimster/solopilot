import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { CardFlash, type Flash } from './shared';

interface GraphqlCardProps {
  envDefaults: Record<string, string>;
  onSaved: () => void;
}

export function GraphqlCard({ envDefaults, onSaved }: GraphqlCardProps) {
  const [flash, setFlash] = useState<Flash>(null);
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const handleDetect = async () => {
    setDetecting(true);
    setFlash(null);
    try {
      const res = await fetch('/api/detect-gql-ids', { method: 'POST' });
      const data = await res.json();
      setFlash({ type: data.success ? 'success' : 'error', message: data.message });
      if (data.success) onSaved();
    } catch {
      setFlash({ type: 'error', message: 'Erreur lors de la détection.' });
    } finally {
      setDetecting(false);
    }
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setFlash(null);
    const formData = new FormData(e.currentTarget);
    const body: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      body[key] = value as string;
    }
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setFlash({ type: data.success ? 'success' : 'error', message: data.message });
      if (data.success) {
        onSaved();
        setShowManual(false);
      }
    } catch {
      setFlash({ type: 'error', message: 'Erreur lors de la sauvegarde.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>IDs GraphQL X</CardTitle>
        <CardDescription>
          Les IDs GraphQL changent quand X déploie une nouvelle version. Utilisez la détection
          automatique ou modifiez-les manuellement si nécessaire.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <CardFlash flash={flash} />

        <div className="grid gap-3 rounded-lg border border-border bg-muted/40 p-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground font-mono">UserByScreenName</p>
            <code className="block rounded-md bg-muted px-2.5 py-1.5 text-sm font-mono text-foreground break-all">
              {envDefaults['X_GQL_USER_BY_SCREEN_NAME_ID'] || (
                <span className="text-muted-foreground italic">Non détecté</span>
              )}
            </code>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground font-mono">HomeLatestTimeline</p>
            <code className="block rounded-md bg-muted px-2.5 py-1.5 text-sm font-mono text-foreground break-all">
              {envDefaults['X_GQL_HOME_TIMELINE_ID'] || (
                <span className="text-muted-foreground italic">Non détecté</span>
              )}
            </code>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleDetect} disabled={detecting}>
            {detecting ? 'Détection en cours...' : 'Détecter les IDs GraphQL'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowManual(!showManual)}
          >
            {showManual ? 'Masquer' : 'Modifier manuellement'}
          </Button>
        </div>

        {showManual && (
          <form onSubmit={handleSave} className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
            <div className="space-y-2">
              <Label htmlFor="gql_user">UserByScreenName ID</Label>
              <Input
                id="gql_user"
                name="X_GQL_USER_BY_SCREEN_NAME_ID"
                type="text"
                defaultValue={envDefaults['X_GQL_USER_BY_SCREEN_NAME_ID'] || ''}
                placeholder="ex: qW5u-DAuXpMEG0zA1F7UGQ"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gql_timeline">HomeLatestTimeline ID</Label>
              <Input
                id="gql_timeline"
                name="X_GQL_HOME_TIMELINE_ID"
                type="text"
                defaultValue={envDefaults['X_GQL_HOME_TIMELINE_ID'] || ''}
                placeholder="ex: ulQKqowrFU94KfUAZqgGvg"
              />
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? 'Enregistrement...' : 'Sauvegarder les IDs'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
