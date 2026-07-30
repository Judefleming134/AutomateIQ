import { Linkedin } from "lucide-react";
import { requireGrowth } from "@/lib/growth/auth";
import { loadStories } from "@/lib/growth/news";
import { StoryCard } from "./story-card";

export const metadata = { title: "LinkedIn stories · Growth Engine" };

// Six feeds fetched in parallel, each with its own 8s budget.
export const maxDuration = 30;
// Feeds move hourly at most; this keeps the page instant on repeat visits and
// is polite to the publishers.
export const revalidate = 1800;

/**
 * Story-led LinkedIn posting.
 *
 * A lot of Jude's market reads its news on LinkedIn, and a post that reacts to
 * something real gets far more attention than another "here's what we do".
 * This pulls AI and Irish-business stories, keeps only the ones that map to
 * something he actually sells, and writes the caption — so the job goes from
 * "find something to post about" to "pick one, attach a photo, paste".
 */
export default async function LinkedInPage() {
  await requireGrowth();
  const { stories, failed } = await loadStories(12);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            <Linkedin size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />
            LinkedIn stories
          </h1>
          <p>
            Today&apos;s AI and Irish business news, filtered down to the stories that
            actually connect to what you sell. Pick one, choose the angle, and you get a
            caption ready to paste — attach your own photo and post it.
          </p>
        </div>
      </div>

      {stories.length === 0 ? (
        <div className="panel panel-block">
          <p className="empty-state" style={{ margin: 0 }}>
            {failed.length > 0 ? (
              <>
                Couldn&apos;t reach {failed.length === 1 ? "the news feed" : "the news feeds"}{" "}
                just now ({failed.join(", ")}). This is almost always temporary — refresh
                in a few minutes.
              </>
            ) : (
              <>
                Nothing in today&apos;s news maps closely enough to what you sell to be
                worth posting about. That happens — a forced post about an unrelated story
                does more harm than no post. Check back later; the feeds refresh through
                the day.
              </>
            )}
          </p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "var(--faint)", margin: "0 0 12px" }}>
            {stories.length} {stories.length === 1 ? "story" : "stories"} worth posting
            about · best fit first
            {/* A dead feed is named rather than silently dropped — otherwise a
                thin list looks like a quiet news day when it's actually an
                outage. */}
            {failed.length > 0 && (
              <>
                {" "}·{" "}
                <span style={{ color: "var(--orange, #fb923c)" }}>
                  {failed.join(", ")} didn&apos;t respond, so {failed.length === 1 ? "that source is" : "those sources are"} missing
                </span>
              </>
            )}
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            {stories.map((s) => (
              <StoryCard key={s.id} story={s} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
