import Link from "next/link";
import { ArrowRight, Lock, Sparkles } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import {
  AGENT_MODULES,
  getEnabledProductKeys,
  getInstalledAgents,
} from "@/lib/agents/registry";
import { ProductIcon } from "@/lib/products/icons";

export default async function ProductsPage() {
  await requireSession();
  const supabase = await createClient();

  const enabledKeys = await getEnabledProductKeys(supabase);
  const installed = getInstalledAgents(enabledKeys);
  const hasAssistant = enabledKeys.has("ai-assistant");

  // Live per-module usage, RLS-scoped.
  const [{ count: requests }, { count: leads }, { count: conversations }, { data: customModules }] =
    await Promise.all([
      supabase
        .from("ra_review_requests")
        .select("id", { count: "exact", head: true }),
      supabase.from("wa_leads").select("id", { count: "exact", head: true }),
      supabase
        .from("aa_conversations")
        .select("id", { count: "exact", head: true }),
      supabase.from("custom_modules").select("id, name, description, route_slug"),
    ]);

  const usage: Record<string, string> = {
    "review-agent": `${requests ?? 0} review requests`,
    "website-agent": `${leads ?? 0} leads captured`,
    "ai-assistant": `${conversations ?? 0} conversations`,
  };

  const available = AGENT_MODULES.filter(
    (m) => m.availability === "live" && !enabledKeys.has(m.key)
  );
  const upcoming = AGENT_MODULES.filter((m) => m.availability === "coming_soon");

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Products</h1>
          <p>
            Your AI workforce — every agent installed on your account, and
            what&apos;s arriving next. All of them work through your AI
            Assistant.
          </p>
        </div>
      </div>

      <h2 className="section-title">Installed</h2>
      <div className="product-grid" style={{ marginBottom: 30 }}>
        {hasAssistant && (
          <Link
            href="/portal/ai-assistant"
            className="product-tile panel"
            style={{ "--tile-accent": "#22D3EE" } as React.CSSProperties}
          >
            <div className="product-tile-icon">
              <Sparkles size={21} />
            </div>
            <h3>AI Assistant</h3>
            <p>
              The platform core — your AI business partner that runs every
              other agent for you.
            </p>
            <span className="product-meta">
              <span className="badge badge-green">Active</span>
              <span className="product-usage">{usage["ai-assistant"]}</span>
              <span className="product-version">v2.0</span>
            </span>
          </Link>
        )}
        {installed.map((m) => (
          <Link
            key={m.key}
            href={m.href ?? "/portal/products"}
            className="product-tile panel"
            style={{ "--tile-accent": m.accent } as React.CSSProperties}
          >
            <div className="product-tile-icon">
              <ProductIcon name={m.iconName} size={21} />
            </div>
            <h3>{m.name}</h3>
            <p>{m.description}</p>
            <span className="product-meta">
              <span className="badge badge-green">Active</span>
              {usage[m.key] && (
                <span className="product-usage">{usage[m.key]}</span>
              )}
              <span className="product-version">v{m.version}</span>
            </span>
          </Link>
        ))}
        {(customModules ?? []).map((m) => (
          <Link
            key={m.id}
            href={`/portal/custom-solutions/${m.route_slug}`}
            className="product-tile panel"
            style={{ "--tile-accent": "#F472B6" } as React.CSSProperties}
          >
            <div className="product-tile-icon">
              <ProductIcon name="box" size={21} />
            </div>
            <h3>{m.name}</h3>
            <p>{m.description ?? "Custom module built for your business."}</p>
            <span className="product-meta">
              <span className="badge badge-green">Active</span>
              <span className="product-version">custom</span>
            </span>
          </Link>
        ))}
        {!hasAssistant && installed.length === 0 && (customModules ?? []).length === 0 && (
          <p className="empty-state">
            Nothing installed yet — talk to us about getting set up.
          </p>
        )}
      </div>

      {available.length > 0 && (
        <>
          <h2 className="section-title">Available now</h2>
          <div className="product-grid" style={{ marginBottom: 30 }}>
            {available.map((m) => (
              <div
                key={m.key}
                className="product-tile panel"
                style={{ "--tile-accent": m.accent } as React.CSSProperties}
              >
                <div className="product-tile-icon">
                  <ProductIcon name={m.iconName} size={21} />
                </div>
                <h3>{m.name}</h3>
                <p>{m.description}</p>
                <span className="product-meta">
                  <a
                    href={`mailto:hello@automateiq.ie?subject=Enable ${m.name}`}
                    className="badge badge-blue"
                    style={{ textDecoration: "none" }}
                  >
                    Ask us to enable <ArrowRight size={10} />
                  </a>
                  <span className="product-version">v{m.version}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="section-title">Coming soon</h2>
      <p style={{ margin: "-6px 0 16px", fontSize: 12.5, color: "var(--faint)", maxWidth: "62ch" }}>
        Each of these plugs straight into your AI Assistant when it launches —
        no new apps, no new logins, no re-learning anything.
      </p>
      <div className="product-grid">
        {upcoming.map((m) => (
          <div
            key={m.key}
            className="product-tile panel is-disabled"
            style={{ "--tile-accent": m.accent } as React.CSSProperties}
          >
            <div className="product-tile-icon">
              <ProductIcon name={m.iconName} size={21} />
            </div>
            <h3>{m.name}</h3>
            <p>{m.description}</p>
            <ul className="product-caps">
              {m.capabilities.slice(0, 4).map((cap) => (
                <li key={cap}>{cap}</li>
              ))}
            </ul>
            <span className="product-meta">
              <span className="badge badge-gray">
                <Lock size={11} /> Coming soon
              </span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
