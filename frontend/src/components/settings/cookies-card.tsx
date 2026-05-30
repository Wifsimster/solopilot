import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { StatusDot, CardFlash, type Flash } from './shared';
import type { ConfigResponse } from '@/types';

interface CookiesCardProps {
  credentialInfo: ConfigResponse['credentialInfo'];
  onSaved: () => void;
}

export function CookiesCard({ credentialInfo, onSaved }: CookiesCardProps) {
  const [flash, setFlash] = useState<Flash>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setFlash(null);
    const formData = new FormData(e.currentTarget);
    const body = {
      X_SESSION_AUTH_TOKEN: formData.get('X_SESSION_AUTH_TOKEN') as string,
      X_SESSION_CSRF_TOKEN: formData.get('X_SESSION_CSRF_TOKEN') as string,
    };
    try {
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setFlash({ type: data.success ? 'success' : 'error', message: data.message });
      if (data.success) {
        e.currentTarget.reset();
        onSaved();
      }
    } catch {
      setFlash({ type: 'error', message: 'Erreur lors de la validation des cookies.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">Session Cookies X</div>
            <p className="text-sm text-muted-foreground">
              Cookies de session pour le scraping (extraits depuis votre navigateur : DevTools &gt;
              Application &gt; Cookies &gt; x.com)
            </p>
          </div>
          <StatusDot configured={!!credentialInfo.authTokenMasked && !!credentialInfo.csrfTokenMasked} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <CardFlash flash={flash} />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="auth_token">auth_token</Label>
            <Input
              id="auth_token"
              name="X_SESSION_AUTH_TOKEN"
              type="password"
              placeholder="Collez votre auth_token ici"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {credentialInfo.authTokenMasked ? (
                <>
                  Valeur actuelle :{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{credentialInfo.authTokenMasked}</code>
                </>
              ) : (
                'Non configuré'
              )}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="csrf_token">ct0 (CSRF token)</Label>
            <Input
              id="csrf_token"
              name="X_SESSION_CSRF_TOKEN"
              type="password"
              placeholder="Collez votre ct0 ici"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {credentialInfo.csrfTokenMasked ? (
                <>
                  Valeur actuelle :{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{credentialInfo.csrfTokenMasked}</code>
                </>
              ) : (
                'Non configuré'
              )}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <Button type="submit" disabled={saving}>
              {saving ? 'Validation...' : 'Valider et sauvegarder'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Les cookies seront testés contre l'API X avant d'être sauvegardés.
            </p>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
