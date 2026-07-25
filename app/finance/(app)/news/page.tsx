import { Newspaper, ExternalLink } from "lucide-react";
import { requireTradesAccount } from "@/lib/trades/data";
import { getNews, splitByRelevance, tradeProfile, type NewsItem } from "@/lib/finance/news";

export const metadata = { title: "News · AutomateIQ Finance" };

// Feeds are fetched server-side with per-feed caching; give slow publishers room.
export const maxDuration = 30;

function relTime(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return iso.slice(0, 10);
}

function NewsList({ items, empty }: { items: NewsItem[]; empty: string }) {
  if (items.length === 0) return <p className="empty-state" style={{ margin: 0 }}>{empty}</p>;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {items.map((it) => (
        <a
          key={it.link}
          href={it.link}
          target="_blank"
          rel="noreferrer"
          className="panel"
          style={{ padding: "10px 13px", display: "block" }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>
            {it.title} <ExternalLink size={11} style={{ verticalAlign: "-1px", opacity: 0.6 }} />
          </div>
          <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 3 }}>
            {it.source}
            {it.publishedAt ? ` · ${relTime(it.publishedAt)}` : ""}
          </div>
        </a>
      ))}
    </div>
  );
}

export default async function NewsPage() {
  const { account } = await requireTradesAccount("/finance/login");
  const profile = tradeProfile(account.trade);
  const { items, sourcesUp, sourcesDown } = await getNews(profile.feedTags);
  const { industry, general } = splitByRelevance(items, profile.keywords);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            <Newspaper size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />
            News
          </h1>
          <p>
            {account.trade
              ? `Headlines for ${account.trade.toLowerCase()}s and the money side of business`
              : "Industry and business headlines"}{" "}
            — pulled from the publishers&apos; free feeds, all in one place. No
            subscriptions, ever.
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <section className="panel panel-block">
          <p className="empty-state" style={{ margin: 0 }}>
            The news sources aren&apos;t reachable right now — try again in a few
            minutes. Nothing is wrong with your account.
          </p>
        </section>
      ) : (
        <div className="grid-main-side">
          <section className="panel panel-block" aria-labelledby="news-ind">
            <h2 className="panel-title" id="news-ind">
              For your industry ({industry.length})
            </h2>
            <NewsList
              items={industry.slice(0, 20)}
              empty="Nothing industry-specific in the current headlines — the general feed below has the rest."
            />
          </section>

          <section className="panel panel-block" aria-labelledby="news-gen">
            <h2 className="panel-title" id="news-gen">
              Business &amp; finance headlines
            </h2>
            <NewsList items={general.slice(0, 15)} empty="No general headlines right now." />
          </section>
        </div>
      )}

      <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 14 }}>
        Sources: {sourcesUp.join(", ") || "none reachable"}
        {sourcesDown.length > 0 ? ` · temporarily unavailable: ${sourcesDown.join(", ")}` : ""}. Headlines
        link to the original publisher and refresh about every 30 minutes.
        Set your trade in Settings to sharpen the industry filter.{" "}
        <span className="badge badge-gray">AI daily digest — not available yet</span>
      </p>
    </>
  );
}
