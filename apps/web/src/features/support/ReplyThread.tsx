import type { TicketReply } from "@symptomsketch/contracts";
import { formatTimestamp } from "@/lib/format";
import { AttachmentCard } from "./AttachmentCard";

interface ReplyThreadProps {
  ticketId: string;
  replies: readonly TicketReply[];
  emptyText: string;
}

const ROLE_LABEL: Record<TicketReply["authorRole"], string> = { support: "Demo Support" };

/** Persisted replies in order, each with its author role, time and optional reply clip. */
export function ReplyThread({ ticketId, replies, emptyText }: ReplyThreadProps) {
  if (replies.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <ol className="flex flex-col gap-4" aria-label="Replies">
      {replies.map((reply) => (
        <li key={reply.id}>
          <article className="rounded-xl border border-l-2 border-l-magenta bg-card p-4">
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">
                {reply.authorLabel || ROLE_LABEL[reply.authorRole]}
                {reply.authorLabel && reply.authorLabel !== ROLE_LABEL[reply.authorRole] ? (
                  <span className="font-normal text-muted-foreground">
                    {" · "}
                    {ROLE_LABEL[reply.authorRole]}
                  </span>
                ) : null}
              </p>
              <time className="font-mono text-xs text-muted-foreground" dateTime={reply.createdAt}>
                {formatTimestamp(reply.createdAt)}
              </time>
            </header>
            <p className="mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap">
              {reply.text}
            </p>
            {reply.attachment ? (
              <AttachmentCard className="mt-3" ticketId={ticketId} attachment={reply.attachment} />
            ) : null}
          </article>
        </li>
      ))}
    </ol>
  );
}
