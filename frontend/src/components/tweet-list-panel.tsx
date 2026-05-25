import { useState } from "react";
import { useApi } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink, MessageSquare } from "lucide-react";
import type { TweetRecord } from "@/types";

function formatTweetDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TweetListPanel({ runId, tweetCount }: { runId: number; tweetCount: number }) {
  const [limit, setLimit] = useState(50);
  const { data, loading } = useApi<{ tweets: TweetRecord[]; total: number }>(
    `/api/runs/${runId}/tweets?limit=${limit}`,
  );

  if (loading && !data) {
    return (
      <div className="space-y-3">
        {Array.from({ length: Math.min(tweetCount, 5) }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (!data || data.tweets.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>Tweets non disponibles pour ce run.</p>
        {tweetCount > 0 && (
          <p className="text-xs mt-1">
            Ce run date d'avant le suivi détaillé des tweets.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
        <span>{data.total} tweet{data.total > 1 ? "s" : ""} utilisé{data.total > 1 ? "s" : ""}</span>
      </div>

      <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-12rem)] pr-1">
        {data.tweets.map((tweet) => (
          <Card
            key={tweet.id}
            className="p-3 text-sm space-y-1.5 hover:bg-muted/50 shadow-none"
          ><CardContent className="p-0 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <p className="leading-relaxed whitespace-pre-wrap break-words flex-1">
                {tweet.text}
              </p>
              <a
                href={`https://x.com/i/status/${tweet.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Voir sur X"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {formatTweetDate(tweet.createdAt)}
              </span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {tweet.source === 'reddit' ? 'Reddit' : 'X'}
              </Badge>
              {tweet.urls.length > 0 && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {tweet.urls.length} lien{tweet.urls.length > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
          </CardContent></Card>
        ))}
      </div>

      {data.total > data.tweets.length && (
        <Button
          variant="outline"
          size="sm"
          className="w-full mt-2"
          onClick={() => setLimit((prev) => prev + 50)}
        >
          Charger plus ({data.total - data.tweets.length} restants)
        </Button>
      )}
    </div>
  );
}
