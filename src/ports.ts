export type ItemSource = 'x' | 'reddit' | 'hn';

export interface Item {
  id: string;
  source: ItemSource;
  text: string;
  author: string;
  url: string;
  createdAt: string;
  fetchedAt: string;
  productId: string;
  urls: string[];
}

export interface SourceOpts {
  productId: string;
  lookbackDays?: number;
}

export interface SourceReader {
  source: ItemSource;
  fetchSince(productId: string, sinceTs: number, opts: SourceOpts): Promise<Item[]>;
}

export type Tweet = Item;
export type TweetReader = SourceReader & {
  fetchRecentTweets(): Promise<Item[]>;
};

export function isXUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      hostname === 'twitter.com' ||
      hostname === 'x.com' ||
      hostname.endsWith('.twitter.com') ||
      hostname.endsWith('.x.com')
    );
  } catch {
    return false;
  }
}
