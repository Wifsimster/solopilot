import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

// DO NOT add rehype-raw — AI-generated content must not render arbitrary HTML.
// react-markdown strips raw HTML by default, which is the desired security posture.
export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <ReactMarkdown
      className={cn('space-y-2', className)}
      components={{
        p: ({ children }) => <p className="leading-relaxed">{children}</p>,
        strong: ({ children }) => (
          <strong className="font-semibold text-foreground">{children}</strong>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:text-primary/80"
          >
            {children}
          </a>
        ),
        ul: ({ children }) => <ul className="list-disc pl-4 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 space-y-1">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        h1: ({ children }) => <h2 className="font-bold text-base">{children}</h2>,
        h2: ({ children }) => <h3 className="font-bold text-base">{children}</h3>,
        h3: ({ children }) => <h4 className="font-semibold text-sm">{children}</h4>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
